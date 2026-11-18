import { validPhotoDataUrl } from '../domain/photo';

/** Check JPEG dimensions before the browser allocates an image decoder surface. */
export function validMobilePhoto(value: unknown): value is string {
  if (!validPhotoDataUrl(value)) return false;
  let bytes: string;
  try { bytes = atob(value.slice('data:image/jpeg;base64,'.length)); } catch { return false; }
  if (bytes.length < 4 || bytes.charCodeAt(0) !== 0xff || bytes.charCodeAt(1) !== 0xd8) return false;
  let pos = 2;
  while (pos < bytes.length) {
    if (bytes.charCodeAt(pos++) !== 0xff) return false;
    while (pos < bytes.length && bytes.charCodeAt(pos) === 0xff) pos++;
    const marker = bytes.charCodeAt(pos++);
    if (!Number.isFinite(marker) || marker === 0 || marker === 0xd9 || marker === 0xda) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > bytes.length) return false;
    const length = (bytes.charCodeAt(pos) << 8) | bytes.charCodeAt(pos + 1);
    if (length < 2 || pos + length > bytes.length) return false;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return false;
      const height = (bytes.charCodeAt(pos + 3) << 8) | bytes.charCodeAt(pos + 4);
      const width = (bytes.charCodeAt(pos + 5) << 8) | bytes.charCodeAt(pos + 6);
      return width > 0 && height > 0 && width <= 1280 && height <= 1280;
    }
    pos += length;
  }
  return false;
}
