import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSingerStaticHandler } from '../../src/main/remote-static';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tpv-static-'));
  mkdirSync(join(root, '.vite')); mkdirSync(join(root, 'src', 'remote'), { recursive: true }); mkdirSync(join(root, 'assets'));
  const manifest = {
    'src/remote/index.html': { file: 'assets/singer.js', imports: ['_shared.js'], css: ['assets/singer.css'] },
    '_shared.js': { file: 'assets/shared.js' },
    'src/renderer/index.html': { file: 'assets/host.js', isEntry: true },
  };
  writeFileSync(join(root, '.vite', 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'src', 'remote', 'index.html'), '<!doctype html><script type="module" src="/assets/singer.js"></script>');
  writeFileSync(join(root, 'assets', 'singer.js'), 'import "./shared.js"');
  writeFileSync(join(root, 'assets', 'shared.js'), 'export const shared = true');
  writeFileSync(join(root, 'assets', 'singer.css'), 'body { color: white }');
  writeFileSync(join(root, 'assets', 'host.js'), 'private host asset');
  writeFileSync(join(root, 'secret.txt'), 'private file');
  return { root, manifest };
}

test('serves only singer manifest dependencies with restrictive headers and no query strings', async () => {
  const { root } = fixture();
  const handler = createSingerStaticHandler(root);
  const server = createServer((req, res) => { void handler(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server unavailable.');
  const get = (path: string, method = 'GET') => new Promise<{ status: number; text: string; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path, method }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
  try {
    const page = await get('/singer/');
    assert.equal(page.status, 200); assert.match(page.headers['content-type']!, /^text\/html/);
    assert.match(String(page.headers['content-security-policy']), /connect-src 'self'/);
    assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(page.headers['x-content-type-options'], 'nosniff'); assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    assert.equal((await get('/assets/singer.js')).status, 200);
    assert.match((await get('/assets/shared.js')).headers['content-type']!, /^text\/javascript/);
    assert.match((await get('/assets/singer.css')).headers['content-type']!, /^text\/css/);
    assert.equal((await get('/assets/host.js')).status, 404);
    assert.equal((await get('/src/remote/index.html')).status, 404);
    assert.equal((await get('/assets/../secret.txt')).status, 404);
    assert.equal((await get('/assets/%2e%2e/secret.txt')).status, 404);
    assert.equal((await get('/singer/?invite=private-secret')).status, 400);
    assert.equal((await get('/assets/singer.js?secret=private-secret')).status, 400);
    assert.equal((await get('/singer/', 'POST')).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses invalid manifest asset paths and missing dependencies before serving anything', () => {
  const { root, manifest } = fixture();
  try {
    manifest['src/remote/index.html'].file = 'assets/../../secret.txt';
    writeFileSync(join(root, '.vite', 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => createSingerStaticHandler(root), /asset name/);
    manifest['src/remote/index.html'].file = 'assets/singer.js';
    manifest['src/remote/index.html'].imports = ['_missing.js'];
    writeFileSync(join(root, '.vite', 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => createSingerStaticHandler(root), /dependency/);
    manifest['src/remote/index.html'].imports = ['src/renderer/index.html'];
    writeFileSync(join(root, '.vite', 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => createSingerStaticHandler(root), /unrelated entry/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
