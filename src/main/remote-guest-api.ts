/** Guest-only API parser. The owning server must enforce exact Host and Origin before calling it. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JoinRevisionConflict, type RemoteQueue } from './remote-queue';
import { MAX_PHOTO_BODY_BYTES } from '../domain/photo';

export type GuestAuthority = Pick<RemoteQueue, 'admissionInfo' | 'join' | 'resume' | 'snapshot' | 'catalog' | 'outcome' | 'submit' | 'submitMissing' | 'withdraw'> & Partial<Pick<RemoteQueue, 'setAvailability' | 'applaud' | 'submitPhoto'>>;
const MAX_BODY = 8192, MAX_RESPONSE = 2 * 1024 * 1024;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, fields: string[]): boolean { return Object.keys(value).every(key => fields.includes(key)) && fields.every(key => key in value); }
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_RESPONSE) { reply(response, 503, { error: 'Response is unavailable.' }); return; }
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  response.end(body);
}
function fail(response: ServerResponse, status: number): void { reply(response, status, { error: 'Request could not be completed.' }); }
class BodyLimitError extends Error {}
function refuseLarge(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader('Connection', 'close'); response.once('finish', () => request.socket.destroy()); fail(response, 413); request.resume();
}
function body(request: IncomingMessage, maximum: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maximum) { reject(new BodyLimitError()); request.resume(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid JSON')); } });
    request.on('error', reject); request.on('aborted', () => reject(new Error('aborted')));
  });
}

export function createGuestApiHandler(authority: GuestAuthority) {
  let photoReading = false;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.method !== 'POST' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') ||
        !request.url || request.url.includes('?') || request.url.includes('#')) { fail(response, 400); return true; }
    const photo = request.url === '/api/v1/photo';
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
    if (photo) {
      if (!bearer || !authority.submitPhoto) { request.resume(); fail(response, 400); return true; }
      try { authority.snapshot(bearer); } catch { request.resume(); fail(response, 400); return true; }
      if (photoReading) { request.resume(); fail(response, 429); return true; }
      photoReading = true;
    }
    const maximum = photo ? MAX_PHOTO_BODY_BYTES : MAX_BODY;
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maximum)) { if (photo) photoReading = false; refuseLarge(request, response); return true; }
    let payload: unknown;
    try { payload = await body(request, maximum); } catch (error) { if (error instanceof BodyLimitError) refuseLarge(request, response); else fail(response, 400); return true; }
    finally { if (photo) photoReading = false; }
    if (!object(payload)) { fail(response, 400); return true; }
    try {
      let result: unknown;
      switch (request.url) {
        case '/api/v1/admission':
          if (!exact(payload, ['invitation']) || bearer) throw new Error();
          result = authority.admissionInfo(payload.invitation); break;
        case '/api/v1/join':
          if (!exact(payload, ['invitation', 'joinId', 'resumeSecret', 'name', 'expectedRevision']) || bearer) throw new Error();
          result = authority.join(payload.invitation, payload.joinId, payload.resumeSecret, payload.name, payload.expectedRevision); break;
        case '/api/v1/resume':
          if (!exact(payload, ['resumeSecret']) || bearer) throw new Error();
          result = authority.resume(payload.resumeSecret); break;
        case '/api/v1/snapshot':
          if (!exact(payload, []) || !bearer) throw new Error();
          result = authority.snapshot(bearer); break;
        case '/api/v1/catalog':
          if (!(exact(payload, ['offset', 'limit']) || exact(payload, ['offset', 'limit', 'query'])) || (payload.query !== undefined && typeof payload.query !== 'string') || !bearer || typeof payload.offset !== 'number' || typeof payload.limit !== 'number') throw new Error();
          result = authority.catalog(bearer, payload.offset, payload.limit, payload.query as string | undefined); break;
        case '/api/v1/outcome':
          if (!exact(payload, ['commandId']) || !bearer) throw new Error();
          result = authority.outcome(bearer, payload.commandId); break;
        case '/api/v1/request':
          if (!exact(payload, ['command']) || !bearer) throw new Error();
          result = authority.submit(bearer, payload.command); break;
        case '/api/v1/withdraw':
          if (!exact(payload, ['command']) || !bearer) throw new Error();
          result = authority.withdraw(bearer, payload.command); break;
        case '/api/v1/availability':
          if (!exact(payload, ['command']) || !bearer || !authority.setAvailability) throw new Error();
          result = authority.setAvailability(bearer, payload.command); break;
        case '/api/v1/applause':
          if (!exact(payload, ['command']) || !bearer || !authority.applaud) throw new Error();
          result = await authority.applaud(bearer, payload.command); break;
        case '/api/v1/photo':
          if (!exact(payload, ['command']) || !bearer || !authority.submitPhoto) throw new Error();
          result = await authority.submitPhoto(bearer, payload.command); break;
        case '/api/v1/missing-request':
          if (!exact(payload, ['command']) || !bearer) throw new Error();
          result = authority.submitMissing(bearer, payload.command); break;
        default: fail(response, 404); return true;
      }
      reply(response, 200, result);
    } catch (error) {
      if (request.url === '/api/v1/join' && error instanceof JoinRevisionConflict) reply(response, 409, { error: 'REVISION_CONFLICT' });
      else fail(response, 400);
    }
    return true;
  };
}
