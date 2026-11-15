import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { KaraFunSessionVault, secureKaraFunVaultBackend, type KaraFunVaultCipher } from '../../src/main/karafun-session-vault';

const record = { sessionKey: 'private-fixture-session-key', clientId: '6', accountScope: 'a'.repeat(64) };
function cipher(): KaraFunVaultCipher {
  const key = randomBytes(32);
  return {
    available: async () => true,
    encrypt: async value => { const iv = randomBytes(12), encoder = createCipheriv('aes-256-gcm', key, iv), body = Buffer.concat([encoder.update(value, 'utf8'), encoder.final()]); return Buffer.concat([iv, encoder.getAuthTag(), body]); },
    decrypt: async value => { const decoder = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decoder.setAuthTag(value.subarray(12, 28)); return { result: Buffer.concat([decoder.update(value.subarray(28)), decoder.final()]).toString('utf8'), shouldReEncrypt: false }; },
  };
}
async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const root = await realpath(tmpdir()), folder = await mkdtemp(join(root, 'tpv-karafun-vault-'));
  t.after(async () => { const actual = await realpath(folder); assert.equal(dirname(actual), root); assert.ok(basename(actual).startsWith('tpv-karafun-vault-')); await rm(actual, { recursive: true, force: true }); });
  const file = join(folder, 'session.bin'), cryptography = cipher();
  return { folder, file, cryptography, vault: new KaraFunSessionVault(file, { cipher: async () => cryptography }) };
}
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

test('accepted session and opaque cache scope survive a new vault instance with encrypted bytes only', async t => {
  const f = await fixture(t); assert.equal(await f.vault.load(), null); assert.equal(await f.vault.save(record), true);
  const bytes = await readFile(f.file); assert.equal(bytes.subarray(0, 8).toString('ascii'), 'TPVKF01\0');
  for (const privateText of [record.sessionKey, record.accountScope, 'sessionKey', 'accountScope']) assert.equal(bytes.includes(Buffer.from(privateText)), false);
  assert.deepEqual(await new KaraFunSessionVault(f.file, { cipher: async () => f.cryptography }).load(), record);
  if (process.platform !== 'win32') assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(f.folder), ['session.bin']);
});
test('unavailable encryption never creates plaintext or a credential file and preserves an existing encrypted record', async t => {
  const f = await fixture(t), unavailable = { ...f.cryptography, available: async () => false };
  const unsupported = new KaraFunSessionVault(f.file, { cipher: async () => unavailable });
  assert.equal(await unsupported.save(record), false); assert.deepEqual(await readdir(f.folder), []);
  await f.vault.save(record); const before = await readFile(f.file);
  await assert.rejects(unsupported.load(), { code: 'unavailable' }); assert.equal(await unsupported.save(record), false);
  assert.deepEqual(await readFile(f.file), before);
});
test('Linux hardcoded-password and unknown backends are refused while actual secret backends are accepted', () => {
  for (const backend of ['basic_text', 'unknown', undefined, 'invented']) assert.equal(secureKaraFunVaultBackend('linux', backend), false);
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) assert.equal(secureKaraFunVaultBackend('linux', backend), true);
  assert.equal(secureKaraFunVaultBackend('win32'), true); assert.equal(secureKaraFunVaultBackend('darwin'), true);
});
test('corrupt ciphertext and foreign files are rejected with no private details or silent deletion', async t => {
  const f = await fixture(t); await f.vault.save(record); const bytes = await readFile(f.file); bytes[bytes.length - 1] ^= 1; await writeFile(f.file, bytes);
  await assert.rejects(f.vault.load(), error => error instanceof Error && !error.message.includes(record.sessionKey) && !error.message.includes(f.file));
  assert.deepEqual(await readFile(f.file), bytes);
  await writeFile(f.file, 'human file that must survive');
  await assert.rejects(f.vault.load()); await assert.rejects(f.vault.clear()); await assert.rejects(f.vault.save(record));
  assert.equal(await readFile(f.file, 'utf8'), 'human file that must survive');
});
test('explicit forgetting removes only the owned record and a stale scope cannot delete a newer sign-in', async t => {
  const f = await fixture(t); await f.vault.save(record); await writeFile(join(f.folder, 'unrelated.txt'), 'keep');
  await f.vault.clear('b'.repeat(64)); assert.deepEqual(await f.vault.load(), record);
  await f.vault.clear(record.accountScope); assert.equal(await f.vault.load(), null); assert.equal(await readFile(join(f.folder, 'unrelated.txt'), 'utf8'), 'keep');
});
test('cancellation during key access prevents publication and leaves no partial file', async t => {
  const f = await fixture(t), started = deferred<void>(), encrypted = deferred<Buffer>(), controller = new AbortController();
  const vault = new KaraFunSessionVault(f.file, { cipher: async () => ({ ...f.cryptography, encrypt: async value => { started.resolve(); await encrypted.promise; return f.cryptography.encrypt(value); } }) });
  const saving = vault.save(record, controller.signal); await started.promise; controller.abort(); encrypted.resolve(Buffer.alloc(0));
  await assert.rejects(saving, { code: 'cancelled' }); assert.deepEqual(await readdir(f.folder), []);
});
test('serialized sign-out cannot race a pending save into restoring remembered credentials', async t => {
  const f = await fixture(t), started = deferred<void>(), proceed = deferred<void>();
  const vault = new KaraFunSessionVault(f.file, { cipher: async () => ({ ...f.cryptography, encrypt: async value => { started.resolve(); await proceed.promise; return f.cryptography.encrypt(value); } }) });
  const saving = vault.save(record); await started.promise; const clearing = vault.clear(); proceed.resolve();
  assert.equal(await saving, true); await clearing; assert.equal(await vault.load(), null); assert.deepEqual(await readdir(f.folder), []);
});
test('symlink destinations are never followed or replaced by a saved session or sign-out', async t => {
  const f = await fixture(t), other = join(f.folder, 'other.txt'); await writeFile(other, 'keep');
  try { await symlink(other, f.file, 'file'); } catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) { t.skip('Creating symbolic links is not permitted in this environment.'); return; } throw error; }
  await assert.rejects(f.vault.load()); await assert.rejects(f.vault.save(record)); await assert.rejects(f.vault.clear());
  assert.equal(await readFile(other, 'utf8'), 'keep');
});
test('unexpected fields and oversized private envelopes are rejected before saving', async t => {
  const f = await fixture(t);
  for (const bad of [{ ...record, password: 'forbidden' }, { ...record, accountScope: 'not-a-scope' }, { ...record, clientId: 'vendor-key' }, { ...record, sessionKey: 's'.repeat(4097) }]) await assert.rejects(f.vault.save(bad));
  assert.deepEqual(await readdir(f.folder), []);
});
