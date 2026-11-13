import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startCatalogService } from '../../src/catalog/karaokenerds-service';

const token = 'synthetic-catalog-token-0123456789-abcdefghijklmnopqrstuvwxyz';

test('binds only to loopback and closes its dependency once', async () => {
  let closed = 0;
  const service = await startCatalogService({ port: 0, token,
    reader: { async search() { return { items: [], nextCursor: null }; } },
    closeDependencies: async () => { closed++; } });
  try {
    const url = `http://127.0.0.1:${service.port}/v1/catalog/tracks`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/v1/catalog/public/tracks`)).status, 404);
    assert.deepEqual(await (await fetch(url, { headers: { authorization: `Bearer ${token}` } })).json(), { items: [], nextCursor: null });
    await Promise.all([service.stop(), service.stop()]);
    assert.equal(closed, 1);
    await assert.rejects(fetch(url));
  } finally { await service.stop(); }
});

test('public reads require explicit service opt-in and cannot receive a private authorization header', async () => {
  const service = await startCatalogService({ port: 0, token, publicReadEnabled: true,
    reader: { async search() { return { items: [], nextCursor: null }; } }, closeDependencies: async () => {} });
  try {
    const origin = `http://127.0.0.1:${service.port}`;
    assert.equal((await fetch(`${origin}/v1/catalog/public/tracks`)).status, 200);
    assert.equal((await fetch(`${origin}/v1/catalog/tracks`)).status, 401);
    assert.equal((await fetch(`${origin}/v1/catalog/public/tracks`, { headers: { authorization: `Bearer ${token}` } })).status, 400);
  } finally { await service.stop(); }
});

test('invalid configuration fails before opening a listener or closing dependencies', async () => {
  let closed = 0;
  const reader = { async search() { return { items: [], nextCursor: null }; } };
  await assert.rejects(startCatalogService({ port: -1, token, reader, closeDependencies: async () => { closed++; } }), /configuration/);
  await assert.rejects(startCatalogService({ port: 0, token: 'short', reader, closeDependencies: async () => { closed++; } }), /configuration/);
  assert.equal(closed, 0);
});

test('operator process fails closed without printing environment secrets', () => {
  const env = { ...process.env, TPV_KN_MYSQL_SOCKET: '/not-used.sock', TPV_KN_MYSQL_DATABASE: 'catalog',
    TPV_KN_MYSQL_USER: 'reader', TPV_KN_MYSQL_PASSWORD_FILE: '/synthetic-password-never-print',
    TPV_KN_SERVICE_TOKEN_FILE: '/synthetic-token-file', TPV_KN_SERVICE_PORT: '0' };
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-mysql-service.ts'], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stderr.includes('synthetic-password-never-print'), false);
  assert.match(result.stderr, /Catalog service failed to start/);
});

test('operator process rejects an unreachable private database without exposing secret files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpv-service-private-'));
  try {
    const secret = 'synthetic-password-never-print', password = path.join(dir, 'password'), tokenFile = path.join(dir, 'token');
    writeFileSync(password, secret, { mode: 0o600 }); writeFileSync(tokenFile, token, { mode: 0o600 });
    const env = { ...process.env, TPV_KN_MYSQL_SOCKET: path.join(dir, 'missing.sock'), TPV_KN_MYSQL_DATABASE: 'catalog',
      TPV_KN_MYSQL_USER: 'reader', TPV_KN_MYSQL_PASSWORD_FILE: password, TPV_KN_SERVICE_TOKEN_FILE: tokenFile, TPV_KN_SERVICE_PORT: '48312' };
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/karaokenerds-mysql-service.ts'], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes(secret), false); assert.equal(result.stderr.includes(token), false);
    assert.equal(result.stderr.includes(dir), false); assert.match(result.stderr, /Catalog service failed to start/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
