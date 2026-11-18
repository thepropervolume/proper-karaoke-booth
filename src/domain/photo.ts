/** Maximum encoded JPEG and enclosing JSON size for a guest photo submission. */
export const MAX_PHOTO_BYTES = 256 * 1024;
export const MAX_PHOTO_DATA_URL = 4 * Math.ceil(MAX_PHOTO_BYTES / 3) + 'data:image/jpeg;base64,'.length;
export const MAX_PHOTO_BODY_BYTES = MAX_PHOTO_DATA_URL + 2048;

/** The guest client converts JPEG and PNG files to JPEG before sending. */
export function validPhotoDataUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_PHOTO_DATA_URL) return false;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return !!match && match[1].length % 4 === 0;
}
