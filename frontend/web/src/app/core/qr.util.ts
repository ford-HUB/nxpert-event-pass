import * as QRCode from 'qrcode';

/** The QR payload matches the emailed pass and what the scanner expects. */
export function passPayload(token: string): string {
  return `REG:${token}`;
}

/** Renders the pass token to a PNG data URL. */
export function passQrDataUrl(token: string, width = 260): Promise<string> {
  return QRCode.toDataURL(passPayload(token), {
    errorCorrectionLevel: 'Q',
    margin: 2,
    width,
  });
}

/** Triggers a browser download of the QR pass as a PNG image. */
export async function downloadPass(token: string, fileBase: string): Promise<void> {
  const dataUrl = await passQrDataUrl(token, 600);
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${fileBase}-pass.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Slugifies a string for use in a download filename. */
export function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  );
}
