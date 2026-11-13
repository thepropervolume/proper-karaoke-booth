import { randomUUID } from 'node:crypto';
import { open, rename, unlink, writeFile } from 'node:fs/promises';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export function logoDataUrl(data: Buffer): string {
  const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (!data.length || data.length > MAX_LOGO_BYTES || (!png && !jpeg)) throw new Error('Choose a PNG or JPEG image up to 2 MB.');
  return `data:image/${png ? 'png' : 'jpeg'};base64,${data.toString('base64')}`;
}

/** Read only a bounded number of bytes from a user-selected file. */
export async function saveLogo(source: string, destination: string): Promise<string> {
  const file = await open(source, 'r');
  let data: Buffer;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_LOGO_BYTES || stat.size <= 0) throw new Error('Choose a PNG or JPEG image up to 2 MB.');
    const bytes = Buffer.alloc(MAX_LOGO_BYTES + 1);
    const result = await file.read(bytes, 0, bytes.length, 0);
    data = bytes.subarray(0, result.bytesRead);
  } finally { await file.close(); }
  const result = logoDataUrl(data);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, data, { flag: 'wx' }); await rename(temporary, destination); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return result;
}

export async function loadLogo(path: string): Promise<string | null> {
  try {
    const file = await open(path, 'r');
    let data: Buffer;
    try { const bytes = Buffer.alloc(MAX_LOGO_BYTES + 1); const result = await file.read(bytes, 0, bytes.length, 0); data = bytes.subarray(0, result.bytesRead); }
    finally { await file.close(); }
    return logoDataUrl(data);
  } catch { return null; }
}
