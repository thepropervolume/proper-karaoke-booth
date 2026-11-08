import { JoinRevisionConflict, type GuestTransport } from './client';

/** Same-origin HTTPS only. This adapter exposes no host operations. */
export function httpsGuestTransport(origin: string, fetcher: typeof fetch = fetch): GuestTransport {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.origin !== origin) throw new Error('Singer access requires an HTTPS origin.');
  async function post<T>(path: string, body: unknown, session?: string): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = `Bearer ${session}`;
    const response = await fetcher(new URL(path, base), { method: 'POST', headers, body: JSON.stringify(body), credentials: 'omit',
      mode: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) {
      if (path === '/api/v1/join' && response.status === 409) {
        const body: unknown = await response.json().catch(() => null);
        if (body && typeof body === 'object' && 'error' in body && body.error === 'REVISION_CONFLICT') throw new JoinRevisionConflict();
      }
      throw new Error('Connection or authorization failed.');
    }
    return await response.json() as T;
  }
  return {
    admission: invitation => post('/api/v1/admission', { invitation }),
    join: (invitation, joinId, resumeSecret, name, expectedRevision) => post('/api/v1/join', { invitation, joinId, resumeSecret, name, expectedRevision }),
    resume: resumeSecret => post('/api/v1/resume', { resumeSecret }),
    snapshot: session => post('/api/v1/snapshot', {}, session),
    catalog: (session, offset, limit) => post('/api/v1/catalog', { offset, limit }, session),
    submit: (session, command) => post('/api/v1/request', { command }, session),
    withdraw: (session, command) => post('/api/v1/withdraw', { command }, session),
    submitMissing: (session, command) => post('/api/v1/missing-request', { command }, session),
    outcome: (session, commandId) => post('/api/v1/outcome', { commandId }, session),
  };
}
