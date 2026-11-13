import { strict as assert } from 'node:assert';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { createServer, request } from 'node:https';
import { checkServerIdentity, connect } from 'node:tls';
import { test } from 'node:test';
import { createLoopbackIdentity, type LoopbackIdentity } from '../../src/main/loopback-identity';
import { startQuickTunnelLoopback } from '../../src/main/quick-tunnel-loopback';

async function withServer<T>(identity: LoopbackIdentity, run: (port: number) => Promise<T>): Promise<T> {
  const server = createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.2' });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { const address = server.address(); assert.ok(address && typeof address !== 'string'); return await run(address.port); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function handshake(port: number, ca?: Buffer, servername?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port, ca, ...(servername ? { servername } : {}), rejectUnauthorized: true });
    socket.once('secureConnect', () => { socket.destroy(); resolve(); });
    socket.once('error', error => { socket.destroy(); reject(error); });
  });
}

test('fresh CA issues a separate short-lived IP-SAN server certificate without exposing the CA key', async () => {
  const first = await createLoopbackIdentity(), second = await createLoopbackIdentity();
  try {
    const ca = new X509Certificate(first.ca), leaf = new X509Certificate(first.cert);
    assert.equal(ca.ca, true); assert.equal(leaf.ca, false);
    assert.equal(leaf.checkIP('127.0.0.1'), '127.0.0.1');
    assert.equal(leaf.checkIP('127.0.0.2'), undefined);
    assert.ok(leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1'));
    assert.equal(leaf.verify(ca.publicKey), true);
    assert.equal(leaf.checkPrivateKey(createPrivateKey(first.key)), true);
    assert.notEqual(ca.fingerprint256, new X509Certificate(second.ca).fingerprint256);
    assert.notEqual(leaf.fingerprint256, new X509Certificate(second.cert).fingerprint256);
    assert.ok(first.expiresAtMs > Date.now() && first.expiresAtMs <= Date.now() + 24 * 60 * 60 * 1000);
    assert.equal(first.ca.includes('PRIVATE KEY'), false);
    await withServer(first, async port => {
      await handshake(port, first.ca);
      await assert.rejects(handshake(port));
      await assert.rejects(handshake(port, second.ca));
      await assert.rejects(handshake(port, first.ca, 'different.example'));
    });
    first.dispose(); assert.ok(first.key.every(byte => byte === 0));
    first.dispose(); assert.ok(first.key.every(byte => byte === 0));
  } finally { first.dispose(); second.dispose(); }
});

test('expired leaf is rejected by TLS even when its CA is supplied', async () => {
  const identity = await createLoopbackIdentity({ nowMs: Date.now() - 3 * 60 * 60 * 1000, validForMs: 60_000 });
  try {
    assert.ok(new Date(new X509Certificate(identity.ca).validTo).getTime() > Date.now(), 'The CA remains valid so the rejected certificate is the expired leaf.');
    await withServer(identity, async port => { await assert.rejects(handshake(port, identity.ca)); });
  }
  finally { identity.dispose(); }
});

test('pre-abort, asynchronous abort and invalid lifetimes do not return an identity', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(createLoopbackIdentity({ signal: before.signal }), /cancelled/);
  const during = new AbortController(); const pending = createLoopbackIdentity({ signal: during.signal }); during.abort();
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(createLoopbackIdentity({ validForMs: 0 }), /lifetime/);
  await assert.rejects(createLoopbackIdentity({ validForMs: 24 * 60 * 60 * 1000 + 1 }), /lifetime/);
  await assert.rejects(createLoopbackIdentity({ nowMs: Number.MAX_SAFE_INTEGER }), /lifetime/);
});

test('generated identity works with the actual isolated relay gate after caller clears its key buffer', async () => {
  const identity = await createLoopbackIdentity();
  try {
    const gate = await startQuickTunnelLoopback({ ...identity, handler: async (_req, res) => { res.writeHead(200); res.end('ok'); return true; }, onError: () => {} });
    try {
      gate.bindOrigin('https://example.trycloudflare.com');
      identity.dispose();
      const status = await new Promise<number>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: gate.port, ca: identity.ca, path: '/singer/', headers: { host: 'example.trycloudflare.com' },
          checkServerIdentity: (_hostname, cert) => checkServerIdentity('127.0.0.1', cert) }, res => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
        req.once('error', reject); req.end();
      });
      assert.equal(status, 200);
    } finally { await gate.close(); }
  } finally { identity.dispose(); }
});
