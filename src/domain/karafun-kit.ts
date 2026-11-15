import { describeKaraFunStemLabel, KaraFunKitError, parseKaraFunTiming, type KaraFunTiming } from './karafun-kit-timing';

export { KaraFunKitError } from './karafun-kit-timing';
export type KaraFunStem = { id: number; role: 'instrumental' | 'backing' | 'lead' | 'other'; voice: string | null; data: Uint8Array };
export type KaraFunArtwork = { id: number; mimeType: 'image/png' | 'image/jpeg'; data: Uint8Array };
export type KaraFunKit = { timing: KaraFunTiming; stems: KaraFunStem[]; artwork: KaraFunArtwork[] };
export type KaraFunKitLimits = { bytes: number; members: number; chunks: number; memberBytes: number; audioMembers: number; artworkBytes: number };
export const KARAFUN_KIT_LIMITS: Readonly<KaraFunKitLimits> = Object.freeze({
  bytes: 512 * 1024 * 1024, members: 64, chunks: 100_000, memberBytes: 256 * 1024 * 1024, audioMembers: 32, artworkBytes: 16 * 1024 * 1024,
});
function invalid(): never { throw new KaraFunKitError('invalid-container', 'The KaraFun recording is incomplete or has an invalid container.'); }
function limit(): never { throw new KaraFunKitError('container-limit', 'The KaraFun recording exceeds the supported preparation limits.'); }
function unsupported(): never { throw new KaraFunKitError('unsupported-audio', 'The KaraFun recording contains unsupported audio.'); }

function limitsWith(overrides: Partial<KaraFunKitLimits>): KaraFunKitLimits {
  const result = { ...KARAFUN_KIT_LIMITS, ...overrides };
  for (const name of Object.keys(KARAFUN_KIT_LIMITS) as (keyof KaraFunKitLimits)[])
    if (!Number.isSafeInteger(result[name]) || result[name] < 1 || result[name] > KARAFUN_KIT_LIMITS[name]) limit();
  return result;
}
function begins(data: Uint8Array, values: readonly number[]): boolean {
  return data.length >= values.length && values.every((value, index) => data[index] === value);
}

/** Check the first page and codec marker before handing bounded audio to the browser decoder. */
function checkOgg(data: Uint8Array): void {
  if (data.length < 27 || data[4] !== 0 || (data[5] & 2) === 0) unsupported();
  const count = data[26], body = 27 + count;
  if (!count || body > data.length) unsupported();
  let pageBytes = 0;
  for (let i = 27; i < body; i++) pageBytes += data[i];
  if (body + pageBytes > data.length) unsupported();
  const packet = data.subarray(body, body + pageBytes);
  if (!begins(packet, [1, 118, 111, 114, 98, 105, 115]) && !begins(packet, [79, 112, 117, 115, 72, 101, 97, 100])) unsupported();
}

/**
 * Independent reader for the unencrypted, indexed KIT multiplex. The three-byte marker is
 * followed by an id/total-size index and id/size/reserved/data chunks (32-bit big endian).
 * Reserved chunk words are deliberately not interpreted. Every byte and indexed total must
 * agree before any allocation or decoder receives a member; truncated downloads never pass.
 */
export function parseKaraFunKit(input: Uint8Array, overrides: Partial<KaraFunKitLimits> = {}): KaraFunKit {
  const limits = limitsWith(overrides);
  if (!(input instanceof Uint8Array) || input.byteLength < 9 || !begins(input, [1, 0xce, 0xd7])) invalid();
  if (input.byteLength > limits.bytes) limit();
  const count = input[3];
  if (!count) invalid();
  if (count > limits.members) limit();
  const headerEnd = 4 + count * 5;
  if (headerEnd > input.length) invalid();
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const entries = new Map<number, { size: number; received: number; slices: Uint8Array[] }>();
  let indexedBytes = 0;
  for (let at = 4; at < headerEnd; at += 5) {
    const id = input[at], size = view.getUint32(at + 1, false);
    if (entries.has(id) || !size) invalid();
    if (size > limits.memberBytes) limit();
    indexedBytes += size;
    if (indexedBytes > limits.bytes) limit();
    entries.set(id, { size, received: 0, slices: [] });
  }
  if (indexedBytes > input.length - headerEnd) invalid();
  let offset = headerEnd, chunks = 0;
  while (offset < input.length) {
    if (input.length - offset < 9) invalid();
    if (++chunks > limits.chunks) limit();
    const entry = entries.get(input[offset]), size = view.getUint32(offset + 1, false);
    if (!entry || !size || size > input.length - offset - 9 || size > entry.size - entry.received) invalid();
    entry.slices.push(input.subarray(offset + 9, offset + 9 + size));
    entry.received += size; offset += 9 + size;
  }
  for (const entry of entries.values()) if (entry.received !== entry.size) invalid();
  const materialize = (id: number): Uint8Array => {
    const entry = entries.get(id)!;
    const bytes = new Uint8Array(entry.size); let at = 0;
    for (const slice of entry.slices) { bytes.set(slice, at); at += slice.length; }
    return bytes;
  };
  const timingEntry = entries.get(1);
  if (!timingEntry) invalid();
  if (timingEntry.size > 8 * 1024 * 1024) throw new KaraFunKitError('timing-limit', 'The KaraFun timing data exceeds the supported limits.');
  let xml: string;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(materialize(1)); }
  catch { throw new KaraFunKitError('invalid-timing', 'The KaraFun timing data is invalid or unsupported.'); }
  const timing = parseKaraFunTiming(xml);
  const stems: KaraFunStem[] = [], artwork: KaraFunArtwork[] = [];
  let artworkBytes = 0;
  for (const id of [...entries.keys()].sort((a, b) => a - b)) {
    if (id === 1) continue;
    const data = materialize(id);
    if (begins(data, [79, 103, 103, 83])) {
      if (stems.length >= limits.audioMembers) limit();
      checkOgg(data);
      const label = timing.files.find(file => file.id === id)?.label || '';
      const caption = timing.tracks.find(track => track.fileIndex === id && track.caption)?.caption || null;
      stems.push({ id, ...describeKaraFunStemLabel(label, caption), data });
    } else {
      const mimeType = begins(data, [137, 80, 78, 71, 13, 10, 26, 10]) ? 'image/png' : begins(data, [255, 216, 255]) ? 'image/jpeg' : null;
      if (mimeType) {
        artworkBytes += data.length;
        if (artworkBytes > limits.artworkBytes) limit();
        artwork.push({ id, mimeType, data });
      }
      // Non-audio ancillary members are not exposed to the player or interpreted as paths.
    }
  }
  if (!stems.length) unsupported();
  return { timing, stems, artwork };
}
