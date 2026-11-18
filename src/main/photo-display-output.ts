import { randomUUID } from 'node:crypto';
import { nativeImage } from 'electron';
import { MAX_PHOTO_BYTES, validPhotoDataUrl } from '../domain/photo';

/** Read JPEG dimensions before decoding so a tiny decompression bomb is rejected. */
function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let position = 2;
  let dimensions: { width: number; height: number } | null = null;
  while (position + 4 < bytes.length) {
    if (bytes[position++] !== 0xff) return null;
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xda) return dimensions;
    if (marker === 0xd9) return null;
    if (marker === 0xd8 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (position + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8 || dimensions) return null;
      dimensions = { height: bytes.readUInt16BE(position + 3), width: bytes.readUInt16BE(position + 5) };
    }
    position += length;
  }
  return null;
}

export function normalizeGuestPhoto(dataUrl: string): string {
  if (!validPhotoDataUrl(dataUrl)) throw new Error('Choose a supported JPEG or PNG image.');
  const encoded = dataUrl.slice('data:image/jpeg;base64,'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES || bytes.toString('base64') !== encoded)
    throw new Error('The photo is invalid or too large.');
  const size = jpegDimensions(bytes);
  if (!size || !size.width || !size.height || size.width > 1280 || size.height > 1280 || size.width * size.height > 1280 * 1280)
    throw new Error('The photo dimensions are invalid.');
  const image = nativeImage.createFromBuffer(bytes);
  const decoded = image.getSize();
  if (image.isEmpty() || decoded.width !== size.width || decoded.height !== size.height) throw new Error('The photo could not be decoded.');
  for (const quality of [85, 70, 50, 30]) {
    const clean = image.toJPEG(quality);
    if (clean.length <= MAX_PHOTO_BYTES) return `data:image/jpeg;base64,${clean.toString('base64')}`;
  }
  throw new Error('The photo could not be reduced enough.');
}

type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** At most one photo is visible at a time. No photo is written to disk. */
export class PhotoDisplayOutput {
  private readonly pending = new Map<string, Pending>();
  private busyUntil = 0;
  constructor(private readonly send: (request: { id: string; dataUrl: string }) => void) {}

  show(input: string): Promise<void> {
    if (this.pending.size || this.busyUntil > Date.now()) return Promise.reject(new Error('A photo is already being shown. Try again shortly.'));
    const dataUrl = normalizeGuestPhoto(input);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The singer display did not confirm the photo.')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, dataUrl }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('The singer display is unavailable.')); }
    });
  }

  acknowledge(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const { id, ok } = value as Record<string, unknown>;
    if (typeof id !== 'string' || typeof ok !== 'boolean') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (!ok) { pending.reject(new Error('The singer display could not show the photo.')); return; }
    this.busyUntil = Date.now() + 10000;
    pending.resolve();
  }

  clear(): void {
    this.busyUntil = 0;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The singer display closed.'));
    }
    this.pending.clear();
  }
}
