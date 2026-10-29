import { Injectable } from '@angular/core';

export interface TvBanner { eventId: number; image: string; name: string; }

@Injectable({ providedIn: 'root' })
export class TvBannerService {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('event-tv-banners', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('banners', { keyPath: 'eventId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Banner storage is busy in another tab.'));
    });
  }
  private async access<T>(write: boolean, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('banners', write ? 'readwrite' : 'readonly');
        const request = operation(transaction.objectStore('banners'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error('Banner storage was cancelled.'));
      });
    } finally { db.close(); }
  }
  async load(eventId: number): Promise<TvBanner | null> {
    const banner = await this.access<TvBanner | undefined>(false, store => store.get(eventId));
    return banner?.eventId === eventId && /^data:image\/(png|jpeg|webp);base64,/.test(banner.image) ? banner : null;
  }
  async save(banner: TvBanner): Promise<void> { await this.access(true, store => store.put(banner)); }
  async remove(eventId: number): Promise<void> { await this.access(true, store => store.delete(eventId)); }

  async prepare(file: File, eventId: number): Promise<TvBanner> {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)
      throw new Error('Choose a PNG, JPEG or WebP banner up to 10 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image has no readable dimensions.');
      // Preserve original pixels/encoding for HD and 4K uploads; do not repeatedly
      // recompress text-heavy artwork. Only larger source images need resizing.
      if (Math.max(image.naturalWidth, image.naturalHeight) <= 3840) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Could not read this banner.'));
          reader.readAsDataURL(file);
        });
        return { eventId, image: data, name: file.name };
      }
      const scale = Math.min(1, 3840 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d')!;
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/webp', 0.96);
      if (!data.startsWith('data:image/') || data.length > 16_000_000)
        throw new Error('This banner is too large after resizing. Choose a smaller image.');
      return { eventId, image: data, name: file.name };
    } finally { URL.revokeObjectURL(url); }
  }
}
