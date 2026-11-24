import { execFile } from 'node:child_process';
import { createPrivateKey, sign, X509Certificate } from 'node:crypto';
import { lstat, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const appleOrigin = 'https://api.appstoreconnect.apple.com';
const bundleId = 'com.thepropervolume.karaoke';
const idPattern = /^[A-Za-z0-9-]{1,72}$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const teamPattern = /^[A-Z0-9]{10}$/;
const profileNamePattern = /^Booth TestFlight CI [A-Za-z0-9][A-Za-z0-9 -]{0,63}$/;
const maxApiBytes = 2 * 1024 * 1024;
const runCommand = promisify(execFile);

class ProvisioningError extends Error {}

function check(condition, message) {
  if (!condition) throw new ProvisioningError(message);
}

function validId(resource, type) {
  check(resource?.type === type && typeof resource.id === 'string' && idPattern.test(resource.id),
    'Apple did not return a valid resource identifier.');
  return resource.id;
}

function decodeBase64(value, maximum, message) {
  check(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(maximum / 3) * 4 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value), message);
  const bytes = Buffer.from(value, 'base64');
  check(bytes.length <= maximum && bytes.toString('base64') === value, message);
  return bytes;
}

function requestToken(key, keyId, issuerId, scope) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  const body = encode({ alg: 'ES256', kid: keyId, typ: 'JWT' }) + '.' +
    encode({ iss: issuerId, iat: issuedAt, exp: issuedAt + 120, aud: 'appstoreconnect-v1', ...(scope ? { scope: [scope] } : {}) });
  const signature = sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' });
  return body + '.' + signature.toString('base64url');
}

async function apiRequest(fetcher, auth, method, path, body) {
  const url = new URL(path, appleOrigin);
  check(url.origin === appleOrigin, 'Invalid Apple API destination.');
  let response;
  try {
    response = await fetcher(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: 'Bearer ' + requestToken(auth.key, auth.keyId, auth.issuerId, method === 'GET' ? 'GET ' + path : null),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (method === 'DELETE' && (response.status === 204 || response.status === 404)) return null;
    const expectedStatus = method === 'POST' ? 201 : 200;
    if (response.status !== expectedStatus) {
      const reason = response.status === 401 || response.status === 403 ? 'access was denied' :
        response.status === 409 ? 'Apple reported a signing-resource conflict or quota' :
        response.status === 429 ? 'Apple rate-limited the request' : 'Apple rejected the request';
      throw new ProvisioningError('Apple provisioning request failed: ' + reason + '.');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      check(size <= maxApiBytes, 'Apple provisioning response exceeded the size limit.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError(method === 'POST'
      ? 'Apple provisioning did not confirm the create request. Check the Apple account before retrying.'
      : 'Apple provisioning did not return a usable response.');
  } finally {
    if (response?.body) await response.body.cancel().catch(() => {});
  }
}

async function readScratchFile(scratch, input, maxBytes) {
  const file = resolve(scratch, input);
  check(dirname(file) === scratch, 'Signing inputs must be in the private runner directory.');
  const stat = await lstat(file);
  check(stat.isFile() && stat.size > 0 && stat.size <= maxBytes,
    'A signing input was missing or invalid.');
  return readFile(file);
}

function validateCertificate(data, signingKey, teamId) {
  check(data?.attributes?.certificateType === 'DISTRIBUTION',
    'Apple did not return an Apple Distribution certificate.');
  const certificate = decodeBase64(data.attributes.certificateContent, 32 * 1024,
    'Apple did not return a valid distribution certificate.');
  try {
    const x509 = new X509Certificate(certificate);
    check(x509.raw.equals(certificate) && x509.checkPrivateKey(signingKey) &&
      x509.subject.split('\n').includes('OU=' + teamId) &&
      x509.subject.split('\n').some(field => field.startsWith('CN=Apple Distribution:')) &&
      x509.issuer.split('\n').includes('CN=Apple Worldwide Developer Relations Certification Authority') &&
      Date.parse(x509.validFrom) <= Date.now() && Date.parse(x509.validTo) > Date.now(),
      'The distribution certificate does not match this signing key and Apple team.');
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError('Apple did not return a valid distribution certificate.');
  }
  return certificate;
}

async function inspectProfile(profilePath, scratch) {
  const decodedPath = join(scratch, 'decoded-provisioning.plist');
  try {
    await runCommand('/usr/bin/security', ['cms', '-D', '-i', profilePath, '-o', decodedPath],
      { timeout: 10000, maxBuffer: 128 * 1024 });
    const extract = async field => {
      try {
        const { stdout } = await runCommand('/usr/bin/plutil', ['-extract', field, 'raw', '-o', '-', decodedPath],
          { timeout: 5000, maxBuffer: 128 * 1024 });
        return stdout.trim();
      } catch {
        return null;
      }
    };
    const fields = await Promise.all([
      'UUID', 'Name', 'TeamIdentifier.0', 'Platform.0', 'Entitlements.application-identifier',
      'Entitlements.get-task-allow', 'DeveloperCertificates.0', 'ProvisionedDevices.0', 'ProvisionsAllDevices'
    ].map(extract));
    const [uuid, name, team, platform, appId, allowsDebugging, certificate, device, allDevices] = fields;
    return { uuid, name, team, platform, appId, allowsDebugging, certificate, device, allDevices };
  } catch {
    throw new ProvisioningError('macOS could not read the App Store provisioning profile.');
  } finally {
    await unlink(decodedPath).catch(() => {});
  }
}

export async function createProvisioning({ scratch, authKey, keyId, issuerId, teamId, profileName },
  { fetcher = fetch, inspect = inspectProfile } = {}) {
  check(typeof scratch === 'string' && isAbsolute(scratch) && typeof authKey === 'string' &&
    teamPattern.test(keyId ?? '') && uuidPattern.test(issuerId ?? '') && teamPattern.test(teamId ?? '') &&
    profileNamePattern.test(profileName ?? ''), 'Invalid Booth TestFlight provisioning arguments.');
  const config = { certificateId: null, profileId: null };
  const outputs = [];
  let auth;
  try {
    const scratchPath = await realpath(scratch);
    check((await lstat(scratchPath)).isDirectory(), 'A private runner directory is required.');
    const key = createPrivateKey(await readScratchFile(scratchPath, authKey, 4096));
    check(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1',
      'The App Store Connect team API key was not a valid ES256 key.');
    auth = { key, keyId, issuerId };
    const signingKey = createPrivateKey(await readScratchFile(scratchPath, 'signing.key', 8192));
    check(signingKey.asymmetricKeyType === 'rsa' && signingKey.asymmetricKeyDetails?.modulusLength === 2048,
      'The runner must create a new RSA-2048 distribution signing key.');
    const csr = (await readScratchFile(scratchPath, 'signing.csr', 8192)).toString('ascii');
    check(/^-----BEGIN CERTIFICATE REQUEST-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE REQUEST-----\r?\n?$/.test(csr),
      'The runner did not produce a valid certificate signing request.');
    const bundles = await apiRequest(fetcher, auth, 'GET', '/v1/bundleIds?filter[identifier]=' + bundleId);
    check(Array.isArray(bundles?.data) && bundles.data.length === 1 &&
      bundles.data[0]?.attributes?.identifier === bundleId &&
      ['IOS', 'UNIVERSAL'].includes(bundles.data[0].attributes.platform),
      'The selected Apple team does not have one matching iOS Booth App ID.');
    const bundleResourceId = validId(bundles.data[0], 'bundleIds');

    // The previous internal beta keeps its signing certificate. Apple decides whether it can issue one more.
    const existing = await apiRequest(fetcher, auth, 'GET',
      '/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=2');
    check(Array.isArray(existing?.data) && existing.data.length < 2,
      'Two distribution certificates are already listed. Use a reusable signing identity for further uploads.');

    const cert = await apiRequest(fetcher, auth, 'POST', '/v1/certificates', {
      data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } }
    });
    config.certificateId = validId(cert?.data, 'certificates');
    const certificate = validateCertificate(cert.data, signingKey, teamId);
    const profile = await apiRequest(fetcher, auth, 'POST', '/v1/profiles', {
      data: {
        type: 'profiles', attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleResourceId } },
          certificates: { data: [{ type: 'certificates', id: config.certificateId }] }
        }
      }
    });
    config.profileId = validId(profile?.data, 'profiles');
    const attributes = profile.data.attributes;
    check(attributes?.profileType === 'IOS_APP_STORE' && attributes.name === profileName &&
      attributes.profileState === 'ACTIVE' && uuidPattern.test(attributes.uuid ?? ''),
      'Apple did not return the requested active App Store profile.');
    const profileBytes = decodeBase64(attributes.profileContent, 1024 * 1024,
      'Apple did not return valid provisioning profile data.');
    const writeOutput = async (name, bytes) => {
      const output = join(scratchPath, name);
      await writeFile(output, bytes, { mode: 0o600, flag: 'wx' });
      outputs.push(output);
      return output;
    };
    const profileFile = await writeOutput('booth.mobileprovision', profileBytes);
    const verified = await inspect(profileFile, scratchPath);
    check(verified.uuid?.toLowerCase() === attributes.uuid.toLowerCase() &&
      verified.name === profileName && verified.team === teamId && verified.platform === 'iOS' &&
      verified.appId === teamId + '.' + bundleId && verified.allowsDebugging === 'false' &&
      verified.device === null && verified.allDevices !== 'true' &&
      verified.certificate === certificate.toString('base64'),
      'The App Store profile does not match the Booth app, distribution certificate, or Apple team.');
    await writeOutput('distribution.cer', certificate);
    await writeOutput('provisioning.json', JSON.stringify({
      ...config, profileName, profileUuid: verified.uuid
    }) + '\n');
  } catch (error) {
    await Promise.allSettled(outputs.map(output => unlink(output)));
    let cleanupFailed = false;
    if (auth && config.profileId) {
      try { await apiRequest(fetcher, auth, 'DELETE', '/v1/profiles/' + config.profileId); }
      catch { cleanupFailed = true; }
    }
    if (auth && config.certificateId) {
      try { await apiRequest(fetcher, auth, 'DELETE', '/v1/certificates/' + config.certificateId); }
      catch { cleanupFailed = true; }
    }
    if (cleanupFailed) {
      throw new ProvisioningError('Booth provisioning failed and Apple did not confirm cleanup of every new resource.');
    }
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError('Unable to prepare Booth signing files in the private runner directory.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [, , operation, scratch, authKey, keyId, issuerId, teamId, profileName, ...remaining] = process.argv;
    check(process.platform === 'darwin' && operation === 'create' && remaining.length === 0,
      'Run Booth provisioning with the create command on the protected macOS runner.');
    await createProvisioning({ scratch, authKey, keyId, issuerId, teamId, profileName });
    console.log('Prepared and verified the Booth App Store signing files.');
  } catch (error) {
    console.error(error instanceof ProvisioningError ? error.message : 'Booth App Store provisioning failed.');
    process.exitCode = 1;
  }
}
