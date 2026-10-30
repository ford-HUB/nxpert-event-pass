// Shared rich-text helpers for the message editors (invitation composer, mail planner).
// Content is always rebuilt node by node from an allowlist — elements are created and text is
// copied as text, never parsed into the live page as HTML.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 1600;
export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_LIMIT_MESSAGE = 'Use up to five images, at most 2 MB each and 5 MB in total after resizing.';

// Formatting the server keeps (InvitationMessageBuilder.RenderBody) — previews mirror it.
const RICH_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'span', 'h1', 'h2', 'h3', 'a']);
const RICH_STYLES: Record<string, RegExp> = {
  'text-align': /^(left|center|right)$/,
  'font-weight': /^(bold|400|600|700)$/,
  'font-style': /^(italic|normal)$/,
  'text-decoration': /^(underline|line-through)$/,
  color: /^#[0-9a-f]{3}([0-9a-f]{3})?$/,
};
// Dropped with everything inside them (pasted pages and documents carry these).
const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'video', 'audio', 'button', 'input', 'select', 'textarea']);
// Block elements outside the allowlist keep their line breaks as a plain div.
const BLOCK_TAGS = new Set(['section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'address', 'pre', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'dl', 'dt', 'dd', 'h4', 'h5', 'h6', 'center']);
const PNG_PREFIX = 'data:image/png;base64,';

/** Allowlisted copy of a node: only PNG data images, safe links and a few inline styles survive. */
export function cleanNode(node: Node, depth = 0): Node {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? '');
  const fragment = document.createDocumentFragment();
  if (!(node instanceof Element) || depth > 30) return fragment;
  const tag = node.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return fragment;
  if (tag === 'img') {
    const src = node.getAttribute('src') ?? '';
    if (!src.startsWith(PNG_PREFIX)) return fragment;
    return newImage(src, node.getAttribute('alt') || 'Message image');
  }
  const children = Array.from(node.childNodes, (n) => cleanNode(n, depth + 1));
  const style = (node as HTMLElement).style;
  // Google Docs wraps whole selections in <b style="font-weight:normal">.
  const notBold = (tag === 'b' || tag === 'strong') && /^(normal|400)$/.test(style?.getPropertyValue('font-weight').trim() ?? '');
  const as = BLOCK_TAGS.has(tag) ? 'div' : (tag === 'td' || tag === 'th') ? 'span' : tag;
  if (!RICH_TAGS.has(as) || notBold) {
    fragment.append(...children);
    return fragment;
  }
  const el = document.createElement(as);
  if (as === 'a') {
    const href = node.getAttribute('href') ?? '';
    if (/^(https?:\/\/|mailto:)/i.test(href)) el.setAttribute('href', href);
  }
  if (style) {
    for (const [prop, ok] of Object.entries(RICH_STYLES)) {
      const value = style.getPropertyValue(prop).trim().toLowerCase();
      if (value && ok.test(value)) el.style.setProperty(prop, value);
    }
  }
  el.append(...children);
  if (as === 'span' && tag !== 'span') el.append(' ');
  return el;
}

export function newImage(src: string, alt: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  // Inline so images fit the editor too, where component styles don't reach.
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  img.style.display = 'block';
  return img;
}

/** Clean nodes for stored message HTML; older plain-text messages keep their line breaks. */
export function richNodes(html: string | null | undefined): Node[] {
  const value = html ?? '';
  if (!/<[a-z!/]/i.test(value)) {
    return value.split('\n').flatMap((line, i) => (i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
  }
  const doc = new DOMParser().parseFromString(value, 'text/html');
  return Array.from(doc.body.childNodes, (n) => cleanNode(n));
}

/** Message HTML as XHTML for the server, which parses it strictly and rebuilds an allowlist. */
export function toXhtml(html: string | null | undefined): string {
  const root = document.createElement('div');
  root.append(...richNodes(html));
  return new XMLSerializer().serializeToString(root);
}

const infoCache = new Map<string, { text: string; images: number }>();

/** Plain text and image count of message HTML (cached; templates ask often). */
export function richTextInfo(html: string | null | undefined): { text: string; images: number } {
  const value = html ?? '';
  let info = infoCache.get(value);
  if (!info) {
    if (!/<[a-z!/]/i.test(value)) info = { text: value, images: 0 };
    else {
      const doc = new DOMParser().parseFromString(value, 'text/html');
      info = { text: doc.body.textContent ?? '', images: doc.body.querySelectorAll('img').length };
    }
    if (infoCache.size > 100) infoCache.clear();
    infoCache.set(value, info);
  }
  return info;
}

export function richTextIsEmpty(html: string | null | undefined): boolean {
  const info = richTextInfo(html);
  return !info.text.trim() && !info.images;
}

export function pngBytes(dataUrl: string): number {
  return Math.ceil(((dataUrl.split(',')[1]?.length ?? 0) * 3) / 4);
}

/** Images already in an editor, so new ones can be checked against the limits. */
export interface ImageBudget {
  count: number;
  bytes: number;
}

export function imageBudget(root: ParentNode): ImageBudget {
  const images = Array.from(root.querySelectorAll('img'));
  return { count: images.length, bytes: images.reduce((sum, i) => sum + pngBytes(i.getAttribute('src') ?? ''), 0) };
}

/** Re-encodes an image as a static PNG (max 1600 px) and reserves it in the budget. */
export async function toPng(blob: Blob, budget: ImageBudget): Promise<string> {
  if (!blob.type.startsWith('image/') || blob.size > MAX_SOURCE_BYTES) throw new Error('Choose a PNG, JPEG, WebP, GIF or BMP image up to 10 MB.');
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    const size = pngBytes(png);
    if (budget.count >= MAX_IMAGES || size > MAX_IMAGE_BYTES || budget.bytes + size > MAX_TOTAL_IMAGE_BYTES) throw new Error(IMAGE_LIMIT_MESSAGE);
    budget.count++;
    budget.bytes += size;
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** A paste turned into clean nodes; skipped counts images that couldn't be copied. */
export interface PasteResult {
  nodes: Node[];
  skipped: number;
  overLimit: boolean;
}

/** Downloads a web image through the API when its site blocks the browser from reading it. */
export type RemoteImageFetcher = (url: string) => Promise<Blob | undefined>;

/**
 * Text and images from the clipboard. Formatted content (web pages, Docs, Word, Outlook) keeps its
 * basic formatting and images; each image is fetched and re-encoded as PNG. Web images the browser
 * can't read go through fetchRemote; Word and Outlook point their HTML at local temp files, so
 * those images come from the clipboard's RTF copy. Anything else falls back to image files on the
 * clipboard, otherwise it is skipped.
 */
export async function readPaste(data: DataTransfer | null, budget: ImageBudget, fetchRemote?: RemoteImageFetcher): Promise<PasteResult> {
  // The clipboard is only readable during the paste event, so take everything before awaiting.
  const html = data?.getData('text/html') ?? '';
  const text = data?.getData('text/plain') ?? '';
  const rtf = data?.getData('text/rtf') ?? '';
  const files = Array.from(data?.files ?? []).filter((f) => f.type.startsWith('image/'));
  const result: PasteResult = { nodes: [], skipped: 0, overLimit: false };

  const convert = async (blob: Blob | undefined): Promise<string | null> => {
    if (!blob) return null;
    if (budget.count >= MAX_IMAGES) {
      result.overLimit = true;
      return null;
    }
    try {
      return await toPng(blob, budget);
    } catch (error) {
      if (error instanceof Error && error.message === IMAGE_LIMIT_MESSAGE) result.overLimit = true;
      return null;
    }
  };

  const doc = html.trim() ? new DOMParser().parseFromString(html, 'text/html') : null;
  const pastedImages = doc ? Array.from(doc.body.querySelectorAll('img')) : [];
  if (doc && (doc.body.textContent?.trim() || pastedImages.length)) {
    const localImages = rtf && pastedImages.some((i) => isLocalSrc(i.getAttribute('src') ?? '')) ? rtfImages(rtf) : [];
    for (const img of pastedImages) {
      const src = (img.getAttribute('src') ?? '').trim();
      let blob: Blob | undefined;
      if (budget.count >= MAX_IMAGES) result.overLimit = true;
      else if (isLocalSrc(src)) blob = localImages.shift() ?? undefined;
      else {
        blob = await fetchImage(src);
        if (!blob && /^https?:\/\//i.test(src)) blob = await fetchRemote?.(src);
      }
      const png = await convert(blob ?? files.shift());
      if (png) img.setAttribute('src', png);
      else {
        img.remove();
        result.skipped++;
      }
    }
    result.nodes = Array.from(doc.body.childNodes, (n) => cleanNode(n));
    return result;
  }

  // Plain text, then any copied image files (screenshots, images copied from a file browser).
  if (text) result.nodes.push(...richNodes(text));
  for (const file of files) {
    const png = await convert(file);
    if (png) result.nodes.push(newImage(png, file.name || 'Message image'), document.createElement('br'));
    else result.skipped++;
  }
  return result;
}

// Word and Outlook (file:///…clip_image001.png), and inline mail parts (cid:).
function isLocalSrc(src: string): boolean {
  return /^(file:|cid:)/i.test(src.trim());
}

/**
 * Pictures from Word/Outlook RTF, in document order. Each \pict group carries its image as hex;
 * PNG and JPEG are kept, other formats (WMF/EMF drawings) hold their place as null so later
 * pictures still line up with their <img>. \nonshppict groups repeat pictures for old readers.
 */
function rtfImages(rtf: string): (Blob | null)[] {
  const images: (Blob | null)[] = [];
  let at = 0;
  while ((at = rtf.indexOf('{', at)) >= 0) {
    const end = groupEnd(rtf, at);
    const head = /^\{(?:\\\*)?\\(nonshppict|pict)\b/.exec(rtf.slice(at, at + 16));
    if (!head) {
      at++;
      continue;
    }
    if (head[1] === 'pict') images.push(rtfPicture(rtf.slice(at + 1, end - 1)));
    at = end;
  }
  return images;
}

/** Index just past the brace that closes the group opening at start. */
function groupEnd(rtf: string, start: number): number {
  let depth = 0;
  for (let i = start; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return rtf.length;
}

function rtfPicture(body: string): Blob | null {
  // Nested groups (picture properties, ids) can hold hex-looking text; drop them first.
  let flat = body;
  for (let prev = ''; prev !== flat; ) {
    prev = flat;
    flat = flat.replace(/\{[^{}]*\}/g, '');
  }
  const type = /\\pngblip\b/.test(flat) ? 'image/png' : /\\jpegblip\b/.test(flat) ? 'image/jpeg' : null;
  if (!type) return null;
  const hex = flat.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[^0-9a-f]/gi, '');
  if (hex.length < 16 || hex.length % 2) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new Blob([bytes], { type });
}

async function fetchImage(src: string): Promise<Blob | undefined> {
  if (!/^(data:image\/|https?:\/\/|blob:)/i.test(src)) return undefined;
  try {
    const response = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : undefined;
  } catch {
    return undefined;
  }
}

/** Inserts nodes at the current selection and puts the caret after them. */
export function insertAtSelection(nodes: Node[]): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  fragment.append(...nodes);
  const last = fragment.lastChild;
  range.insertNode(fragment);
  if (last) range.setStartAfter(last);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function pasteMessage(result: PasteResult): string {
  if (result.overLimit) return `Some pasted images were left out. ${IMAGE_LIMIT_MESSAGE}`;
  return `${result.skipped} pasted image${result.skipped === 1 ? " couldn't" : "s couldn't"} be copied from the source. Save ${result.skipped === 1 ? 'it' : 'them'} and add with the image button.`;
}
