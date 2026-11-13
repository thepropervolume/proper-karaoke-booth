/** Parse public Karaoke Nerds pages; this module never performs network requests. */
import { parse } from 'parse5';

type Node = { nodeName: string; childNodes?: Node[]; value?: string; attrs?: { name: string; value: string }[] };
type Brand = { name: string; slug: string };
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_NODES = 250_000;

function parsePage(html: string): Node {
  if (typeof html !== 'string' || !html.trim() || Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('Invalid public page.');
  return parse(html) as Node;
}
function attr(node: Node, name: string): string | undefined { return node.attrs?.find(a => a.name === name)?.value; }
function children(node: Node, tag: string): Node[] { return (node.childNodes ?? []).filter(item => item.nodeName === tag); }
function descendants(node: Node, tag: string): Node[] {
  const result: Node[] = [], pending = [node]; let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++count > MAX_NODES) throw new Error('Public page is too complex.');
    if (current.nodeName === tag) result.push(current);
    if (current.childNodes) for (let i = current.childNodes.length - 1; i >= 0; i--) pending.push(current.childNodes[i]);
  }
  return result;
}
function text(node: Node): string { return descendants(node, '#text').map(n => n.value ?? '').join(' ').replace(/\s+/gu, ' ').trim(); }
function findTable(doc: Node, requiredHeaders: string[]): Node {
  const matching = descendants(doc, 'table').filter(table => {
    const head = children(table, 'thead');
    if (head.length !== 1) return false;
    const headers = descendants(head[0], 'th').map(value => text(value).toLowerCase());
    return requiredHeaders.every((required, index) => headers[index] === required);
  });
  if (matching.length !== 1 || children(matching[0], 'tbody').length !== 1) throw new Error('Public page table is missing or ambiguous.');
  return matching[0];
}
function slugFromLink(value: string): string | null {
  let url: URL;
  try { url = new URL(value, 'https://www.karaokenerds.com'); } catch { return null; }
  if (url.protocol !== 'https:' || !['www.karaokenerds.com', 'karaokenerds.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return null;
  const match = /^\/Brand\/([^/]+)\/$/u.exec(url.pathname);
  if (!match) return null;
  let slug: string;
  try { slug = decodeURIComponent(match[1]).normalize('NFC'); } catch { return null; }
  if (!slug || slug.length > 200 || slug === '.' || slug === '..' || /[\/\\?#%\u0000-\u001f\u007f]/u.test(slug)) return null;
  return slug;
}
function videoIdFromLink(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
  let id: string | null = null;
  if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname) && url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
  else if (url.hostname === 'youtu.be' && !url.search && /^\/[A-Za-z0-9_-]{11}$/u.test(url.pathname)) id = url.pathname.slice(1);
  return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
}

/** The index associates a display name with the exact slug, not the feed brand code. */
export function extractBrandDirectory(html: string): Brand[] {
  const table = findTable(parsePage(html), ['brand', 'tracks']);
  const tbody = children(table, 'tbody')[0];
  const brands: Brand[] = [], names = new Map<string, string>(), slugs = new Map<string, string>();
  for (const row of children(tbody, 'tr')) {
    const cells = children(row, 'td');
    if (cells.length < 2) throw new Error('Invalid community brand row.');
    const name = text(cells[0]).normalize('NFC');
    const links = descendants(cells[1], 'a').map(link => slugFromLink(attr(link, 'href') ?? '')).filter((value): value is string => value !== null);
    if (!name || name.length > 200 || links.length !== 1) throw new Error('Invalid community brand row.');
    const slug = links[0], key = name.toLowerCase(), slugKey = slug.toLowerCase();
    if (names.has(key) || slugs.has(slugKey)) throw new Error('Ambiguous community brand directory.');
    names.set(key, slug); slugs.set(slugKey, name); brands.push({ name, slug });
  }
  if (!brands.length) throw new Error('Empty community brand directory.');
  return brands;
}

/** Extract only watch links from rows in the brand's actual artist/title/date table. */
export function extractBrandVideoIds(html: string): string[] {
  const table = findTable(parsePage(html), ['artist', 'title', 'date']);
  const tbody = children(table, 'tbody')[0];
  const ids = new Set<string>();
  for (const row of children(tbody, 'tr')) {
    const cells = children(row, 'td');
    if (cells.length < 4) throw new Error('Invalid brand track row.');
    for (const link of descendants(cells[3], 'a')) {
      if (text(link).toLowerCase() !== 'watch online') continue;
      const id = videoIdFromLink(attr(link, 'href') ?? '');
      if (!id) throw new Error('Invalid brand watch link.');
      ids.add(id);
    }
  }
  return [...ids];
}
