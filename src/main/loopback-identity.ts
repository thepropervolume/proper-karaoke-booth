/** Ephemeral local-origin TLS identity. No system trust, filesystem or network access. */
import 'reflect-metadata';
import { randomBytes, webcrypto } from 'node:crypto';
import { BasicConstraintsExtension, ExtendedKeyUsage, ExtendedKeyUsageExtension, IP, KeyUsageFlags,
  KeyUsagesExtension, SubjectAlternativeNameExtension, X509CertificateGenerator } from '@peculiar/x509';

const cryptoProvider = webcrypto as unknown as Crypto;
const DAY = 24 * 60 * 60 * 1000;
const SKEW = 5 * 60 * 1000;
const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
const signing = { name: 'ECDSA', hash: 'SHA-256' };
export type LoopbackIdentity = { ca: Buffer; cert: Buffer; key: Buffer; expiresAtMs: number; dispose(): void };

/** Trusted main-process caller only; custom clock is for deterministic testing. */
export async function createLoopbackIdentity(options: { signal?: AbortSignal; nowMs?: number; validForMs?: number } = {}): Promise<LoopbackIdentity> {
  const now = options.nowMs ?? Date.now(), duration = options.validForMs ?? DAY;
  if (!Number.isSafeInteger(now) || now < SKEW || !Number.isSafeInteger(duration) || duration < 60_000 || duration > DAY)
    throw new Error('Invalid loopback certificate lifetime.');
  const check = () => { if (options.signal?.aborted) throw new Error('Loopback identity creation was cancelled.'); };
  const serial = () => { const bytes = randomBytes(16); bytes[0] = (bytes[0] & 0x7f) | 1; return bytes.toString('hex'); };
  const notBefore = new Date(Math.floor((now - SKEW) / 1000) * 1000);
  const notAfter = new Date(Math.floor((now + duration) / 1000) * 1000);
  const caNotAfter = new Date(Math.floor((now + DAY) / 1000) * 1000);
  if (!Number.isFinite(notBefore.getTime()) || !Number.isFinite(notAfter.getTime()) || !Number.isFinite(caNotAfter.getTime())) throw new Error('Invalid loopback certificate lifetime.');
  let leafDer: Buffer | undefined, key: Buffer | undefined;
  try {
    check();
    // The CA signing key is not exportable and is discarded after issuing one leaf.
    const caKeys = await cryptoProvider.subtle.generateKey(algorithm, false, ['sign', 'verify']) as CryptoKeyPair;
    check();
    const caName = `CN=TPV Loopback ${serial()}`;
    const ca = await X509CertificateGenerator.createSelfSigned({ name: caName, serialNumber: serial(), keys: caKeys, notBefore, notAfter: caNotAfter,
      signingAlgorithm: signing, extensions: [new BasicConstraintsExtension(true, 0, true), new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true)] }, cryptoProvider);
    check();
    const leafKeys = await cryptoProvider.subtle.generateKey(algorithm, true, ['sign', 'verify']) as CryptoKeyPair;
    check();
    const leaf = await X509CertificateGenerator.create({ subject: 'CN=TPV Loopback', issuer: caName, serialNumber: serial(), publicKey: leafKeys.publicKey,
      signingKey: caKeys.privateKey, notBefore, notAfter, signingAlgorithm: signing,
      extensions: [new BasicConstraintsExtension(false, undefined, true), new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]), new SubjectAlternativeNameExtension([{ type: IP, value: '127.0.0.1' }])] }, cryptoProvider);
    check();
    leafDer = Buffer.from(await cryptoProvider.subtle.exportKey('pkcs8', leafKeys.privateKey));
    check();
    const encoded = leafDer.toString('base64').match(/.{1,64}/g)?.join('\n');
    if (!encoded) throw new Error('Could not encode loopback identity.');
    key = Buffer.from(`-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----\n`, 'ascii');
    check();
    const caPem = Buffer.from(ca.toString('pem')), certPem = Buffer.from(leaf.toString('pem'));
    const secret = key; key = undefined;
    return { ca: caPem, cert: certPem, key: secret, expiresAtMs: notAfter.getTime(),
      dispose() { secret.fill(0); } };
  } finally { leafDer?.fill(0); key?.fill(0); }
}
