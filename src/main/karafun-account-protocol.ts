import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';

/** This parser never resolves a DTD/entity or executes provider content. */
export type KaraFunXml = { name: string; attributes: Record<string, string>; children: KaraFunXml[]; text: string };
const invalid = () => new Error('Invalid KaraFun response.');
export function parseKaraFunXml(body: string): KaraFunXml {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 2 * 1024 * 1024) throw invalid();
  const stack: KaraFunXml[] = []; let root: KaraFunXml | undefined, count = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', () => { throw invalid(); }); parser.on('error', () => { throw invalid(); });
  parser.on('processinginstruction', () => { throw invalid(); });
  parser.on('opentag', tag => {
    if (++count > 25_000 || stack.length >= 64 || Object.keys(tag.attributes).length > 64) throw invalid();
    const element: KaraFunXml = { name: tag.name.split(':').at(-1)!.toLowerCase(), attributes: Object.create(null), children: [], text: '' };
    for (const [original, value] of Object.entries(tag.attributes)) {
      const name = original.split(':').at(-1)!.toLowerCase();
      if (Object.hasOwn(element.attributes, name) || original.length > 256 || value.length > 8192) throw invalid();
      element.attributes[name] = value;
    }
    const parent = stack.at(-1); if (parent) parent.children.push(element); else if (root) throw invalid(); else root = element;
    stack.push(element);
  });
  const append = (value: string) => { const current = stack.at(-1); if (!current) { if (value.trim()) throw invalid(); } else current.text += value; };
  parser.on('text', append); parser.on('cdata', append); parser.on('closetag', () => { if (!stack.pop()) throw invalid(); });
  try { parser.write(body).close(); } catch { throw invalid(); }
  if (!root || stack.length) throw invalid(); return root;
}
export function karaFunElements(node: KaraFunXml, name: string): KaraFunXml[] {
  const found: KaraFunXml[] = [], queue = [node];
  for (let i = 0; i < queue.length; i++) { const item = queue[i]; if (item.name === name) found.push(item); queue.push(...item.children); }
  return found;
}
export function karaFunValue(node: KaraFunXml, name: string): string | null {
  const children = node.children.filter(child => child.name === name), attribute = node.attributes[name]?.trim();
  if (children.length > 1 || attribute !== undefined && children.length && attribute !== children[0].text.trim()) throw invalid();
  return attribute ?? children[0]?.text.trim() ?? null;
}
export function karaFunEnvelopeOk(node: KaraFunXml): boolean { return karaFunValue(node, 'status')?.toLowerCase() === 'ok'; }
export function karaFunSessionKey(node: KaraFunXml): string | null {
  const sessions = karaFunElements(node, 'session'); if (sessions.length > 1) throw invalid();
  const session = sessions[0] ?? node, key = karaFunValue(session, 'key');
  return key && /^[A-Za-z0-9._~-]{1,4096}$/.test(key) ? key : null;
}
/** Protocol serialization facts; no vendor application identity/key is embedded. */
export function karaFunSignedRequest(path: string, query: Record<string, string>, sessionKey: string, unixSeconds: number): { url: string; headers: Record<string, string> } {
  if (!['session/info', 'search/top', 'song/info', 'song/request'].includes(path) || !/^[A-Za-z0-9._~-]{1,4096}$/.test(sessionKey) || !Number.isSafeInteger(unixSeconds)) throw invalid();
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  const entries = Object.entries({ ...query, sk: sessionKey }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const url = `https://api.karafun.com/${path}?${entries.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&')}`;
  const timestamp = String(unixSeconds), signature = createHash('sha256').update(`kfun-v1.5|${url}|${timestamp}|${sessionKey}`).digest('hex');
  return { url, headers: { 'X-Request-Timestamp': timestamp, 'X-Request-Signature': signature,
    'User-Agent': 'TheProperVolumeKaraokeBooth (authenticated account integration)', Accept: 'application/xml,text/xml', 'session-language': 'en-US' } };
}
