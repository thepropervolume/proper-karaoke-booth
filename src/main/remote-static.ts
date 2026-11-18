/** Static singer assets only. This module neither opens a listener nor authenticates requests. */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ENTRY = 'src/remote/index.html';
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;
const MAX_FILES = 512;
const TYPES: Record<string, string> = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', woff: 'font/woff', woff2: 'font/woff2' };
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
type Asset = { bytes: Buffer; type: string };
type Entry = { file: string; imports?: string[]; dynamicImports?: string[]; css?: string[]; assets?: string[] };
export type SingerStaticHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

/**
 * Builds a fixed in-memory allowlist from the singer entry's Vite manifest graph.
 * The owning HTTPS server must validate Host before calling this handler; top-level
 * browser navigations need not carry Origin. Unknown paths and non-GETs return false.
 */
export function createSingerStaticHandler(buildRoot: string): SingerStaticHandler {
  const root = realpathSync(buildRoot);
  let total = 0;
  function load(path: string): Buffer {
    const actual = realpathSync(resolve(root, path));
    const inside = relative(root, actual);
    if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`) || !statSync(actual).isFile()) throw new Error('Invalid singer build asset.');
    const size = statSync(actual).size;
    if (size > MAX_FILE || (total += size) > MAX_TOTAL) throw new Error('Singer build assets exceed size limits.');
    return readFileSync(actual);
  }
  const manifestValue: unknown = JSON.parse(load('.vite/manifest.json').toString('utf8'));
  if (!record(manifestValue)) throw new Error('Invalid singer build manifest.');
  const manifest: Record<string, unknown> = manifestValue;
  const assets = new Map<string, Asset>();
  const html: Asset = { bytes: load(ENTRY), type: 'text/html; charset=utf-8' };
  assets.set('/singer', html); assets.set('/singer/', html);
  const visited = new Set<string>();
  function addFile(path: unknown): void {
    if (typeof path !== 'string' || !/^assets\/[A-Za-z0-9_.-]+\.(js|css|woff2?)$/.test(path)) throw new Error('Invalid singer build asset name.');
    const route = `/${path}`;
    if (assets.has(route)) return;
    if (assets.size >= MAX_FILES) throw new Error('Too many singer build assets.');
    const ext = path.slice(path.lastIndexOf('.') + 1);
    assets.set(route, { bytes: load(path), type: TYPES[ext] });
  }
  function walk(key: string): void {
    if (visited.has(key)) return;
    if (visited.size >= MAX_FILES || !Object.prototype.hasOwnProperty.call(manifest, key)) throw new Error('Invalid singer build dependency.');
    visited.add(key);
    const value = manifest[key];
    if (!record(value) || typeof value.file !== 'string') throw new Error('Invalid singer build dependency.');
    if (key !== ENTRY && value.isEntry === true) throw new Error('Singer build references an unrelated entry.');
    const item = value as Entry;
    addFile(item.file);
    for (const name of ['css', 'assets', 'imports', 'dynamicImports'] as const) {
      const list = item[name];
      if (list === undefined) continue;
      if (!Array.isArray(list) || !list.every(part => typeof part === 'string')) throw new Error('Invalid singer build dependency.');
      for (const part of list) { if (name === 'imports' || name === 'dynamicImports') walk(part); else addFile(part); }
    }
  }
  walk(ENTRY);
  return async (request, response) => {
    if (request.method !== 'GET' || !request.url) return false;
    const url = request.url;
    // Do not accept credentials, cache busters, or other parameters in asset URLs.
    if ((url.startsWith('/singer') || url.startsWith('/assets/')) && (url.includes('?') || url.includes('#'))) {
      response.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Length': '0', 'Referrer-Policy': 'no-referrer' }); response.end(); return true;
    }
    const asset = assets.get(url);
    if (!asset) return false;
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': String(asset.bytes.length), 'Cache-Control': 'no-store',
      'Content-Security-Policy': POLICY, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Cross-Origin-Opener-Policy': 'same-origin' });
    response.end(asset.bytes); return true;
  };
}
