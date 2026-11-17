import { randomBytes } from 'node:crypto';
import type { PartyTymeSong, PartyTymeStatus } from '../domain/partytyme';
import { KaraFunSessionVault } from './karafun-session-vault';
export const PARTY_TYME_SITE = 'https://www.partytymestreaming.com';
export const PARTY_TYME_API = 'https://api-ott.partytymestreaming.com';
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 500): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
export const partyTymeId = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{0,11}$/.test(v);
export class PartyTymeError extends Error {
    constructor(readonly code: 'unavailable' | 'invalid-response' | 'credentials' | 'expired' | 'not-entitled' | 'cancelled') {
        super({
            unavailable: 'Party Tyme could not be reached. Check the connection and retry.', 'invalid-response': 'Party Tyme returned an unsupported response. Reconnect or retry later.',
            credentials: 'Party Tyme did not accept the saved username and password. Choose credentials for the consumer Party Tyme Karaoke service.',
            expired: 'Sign in to Party Tyme in Sources before playing this recording.', 'not-entitled': 'An active Party Tyme consumer Premium subscription is required for this playback connection.', cancelled: 'Party Tyme connection was cancelled.'
        }[code]);
        this.name = 'PartyTymeError';
    }
}
export type PartyTymeMaterial = {
    authToken: string;
    version: string;
    clientToken?: string;
};
export type PartyTymeAuthorization = {
    url: string;
    contentKey: string;
    revision: number;
    accountScope: string;
};
export function partyTymeCredentials(raw: string): {
    username: string;
    password: string;
} {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16 * 1024)
        throw new PartyTymeError('credentials');
    const trimmed = raw.replace(/^\uFEFF/, '').trim();
    if (trimmed.startsWith('{')) {
        let value: unknown;
        try {
            value = JSON.parse(trimmed);
        }
        catch {
            throw new PartyTymeError('credentials');
        }
        if (object(value) && text(value.username ?? value.email, 500) && typeof value.password === 'string' && !!value.password && value.password.length <= 4096)
            return { username: (value.username ?? value.email) as string, password: value.password };
    }
    else {
        const separator = trimmed.indexOf(':');
        if (separator > 0 && separator < 500 && separator < trimmed.length - 1 && !/[\r\n]/.test(trimmed))
            return { username: trimmed.slice(0, separator), password: trimmed.slice(separator + 1) };
    }
    throw new PartyTymeError('credentials');
}
export async function partyTymeBody(response: Response, limit: number, signal: AbortSignal): Promise<string> {
    if (!response.ok || !response.body) {
        void response.body?.cancel().catch(() => {
        });
        throw new PartyTymeError('unavailable');
    }
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let body = '', bytes = 0, finished = false;
    const cancel = () => {
        void reader.cancel().catch(() => {
        });
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        for (;;) {
            signal.throwIfAborted();
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.byteLength;
            if (bytes > limit)
                throw new PartyTymeError('invalid-response');
            body += decoder.decode(part.value, { stream: true });
        }
        signal.throwIfAborted();
        finished = true;
        return body + decoder.decode();
    }
    finally {
        signal.removeEventListener('abort', cancel);
        if (!finished)
            cancel();
        reader.releaseLock();
    }
}
function material(value: unknown): PartyTymeMaterial {
    if (!object(value) || Object.keys(value).some(k => !['authToken', 'version', 'clientToken'].includes(k)) || !text(value.authToken, 4096) ||
        !text(value.version, 20) || !/^\d+(?:\.\d+){0,2}$/.test(value.version) || value.clientToken !== undefined && !text(value.clientToken, 2048))
        throw new PartyTymeError('invalid-response');
    return {
        authToken: value.authToken, version: value.version, ...(value.clientToken ? { clientToken: value.clientToken as string } : {})
    };
}
export function partyTymeSongs(value: unknown): PartyTymeSong[] {
    if (!object(value) || !Array.isArray(value.objects) || value.objects.length > 1000)
        throw new PartyTymeError('invalid-response');
    const seen = new Set<string>();
    return value.objects.flatMap(item => {
        if (!object(item) || item.type !== 'video' || !partyTymeId(item.id) || !text(item.name))
            return [];
        if (seen.has(item.id))
            return [];
        seen.add(item.id);
        // In this catalog "actors" are songwriters, not the original artist.
        // The provider's explicit Made Popular By credit is the verified artist.
        const credit = typeof item.short_description === 'string' ? /^Made Popular By (.+)$/i.exec(item.short_description.trim()) : null;
        const duration = Number(item.duration);
        return [{
                videoId: item.id, title: item.name.trim(), artist: credit?.[1].trim().slice(0, 500) ?? '',
                durationSeconds: Number.isFinite(duration) && duration > 0 && duration <= 86400 ? duration : null, explicit: null
            }];
    }).slice(0, 100);
}
/** Parse a narrow literal supplied by the provider; never evaluate remote JavaScript. */
export function partyTymeProgressive(script: string): {
    url: string;
    contentKey: string;
} {
    const match = /playerSources\.progressive\s*=\s*\[\s*\{\s*url\s*:\s*(['"])(https:\/\/[^'"\s\\]+)\1\s*,\s*mimetype\s*:\s*['"]video\/mp4['"]\s*\}\s*\]/.exec(script);
    if (!match)
        throw new PartyTymeError('invalid-response');
    const url = new URL(match[2]);
    if (url.origin !== 'https://cdnapisec.kaltura.com' || url.username || url.password || url.hash ||
        !/^\/p\/513551\/sp\/51355100\/playManifest\/entryId\/[a-zA-Z0-9_]+\/format\/url\/protocol\/https\/.+\/a\.mp4$/.test(url.pathname))
        throw new PartyTymeError('invalid-response');
    return { url: url.href, contentKey: url.origin + url.pathname };
}
export class PartyTymeAccount {
    private current: PartyTymeStatus = { state: 'disconnected', revision: 0, persistence: 'memory-only', premium: false };
    private live: PartyTymeMaterial | null = null;
    private scope: string | null = null;
    private pending: Promise<PartyTymeStatus> | null = null;
    private controller: AbortController | null = null;
    private listeners = new Set<(status: PartyTymeStatus) => void>();
    constructor(private readonly deps: {
        fetch?: typeof fetch;
        vault?: Pick<KaraFunSessionVault, 'load' | 'save' | 'clear'>;
        timeoutMs?: number;
    } = {}) {
    }
    status(): PartyTymeStatus {
        return { ...this.current };
    }
    revision(): number {
        return this.current.revision;
    }
    accountScope(): string | null {
        return this.live && this.current.state === 'connected' ? this.scope : null;
    }
    subscribe(callback: (status: PartyTymeStatus) => void): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }
    private publish(value: Partial<PartyTymeStatus>): void {
        this.current = { ...this.current, message: undefined, ...value, revision: this.current.revision + 1 };
        for (const fn of this.listeners)
            try {
                fn(this.status());
            }
            catch {
            }
    }
    private signal(signal?: AbortSignal): AbortSignal {
        return AbortSignal.any([AbortSignal.timeout(this.deps.timeoutMs ?? 30000), ...(signal ? [signal] : [])]);
    }
    private async get(url: string, signal: AbortSignal, limit: number): Promise<string> {
        try {
            return await partyTymeBody(await (this.deps.fetch ?? fetch)(url, {
                redirect: 'error', credentials: 'omit', signal,
                headers: {
                    'User-Agent': 'TheProperVolumeKaraokeBooth (consumer account connection)', Referer: PARTY_TYME_SITE + '/', Accept: '*/*'
                }
            }), limit, signal);
        }
        catch (error) {
            throw error instanceof PartyTymeError ? error : new PartyTymeError(signal.aborted ? 'cancelled' : 'unavailable');
        }
    }
    private async api(action: 'authenticate' | 'getconfiguration' | 'search', params: Record<string, string>, record: Partial<PartyTymeMaterial>, signal: AbortSignal): Promise<ObjectValue> {
        const values = new URLSearchParams({
            version: record.version ?? '12.0', device_type: 'desktop', platform: 'web', partner: 'internal', language: 'en', connection: 'wifi', timestamp: String(Math.floor(Date.now() / 1000)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(record.authToken ? { auth_token: record.authToken } : {}), ...(record.clientToken ? { cs_auth_token: record.clientToken } : {}), ...params
        });
        let body: string;
        try {
            const response = await (this.deps.fetch ?? fetch)(PARTY_TYME_API + '/' + action, {
                method: 'POST', redirect: 'error', credentials: 'omit', signal,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded', Referer: PARTY_TYME_SITE + '/', Origin: PARTY_TYME_SITE
                }, body: values.toString()
            });
            if ([401, 403].includes(response.status)) {
                void response.body?.cancel().catch(() => {
                });
                throw new PartyTymeError(action === 'authenticate' ? 'credentials' : 'expired');
            }
            body = await partyTymeBody(response, 2 * 1024 * 1024, signal);
        }
        catch (error) {
            throw error instanceof PartyTymeError ? error : new PartyTymeError(signal.aborted ? 'cancelled' : 'unavailable');
        }
        let value: unknown;
        try {
            value = JSON.parse(body);
        }
        catch {
            throw new PartyTymeError('invalid-response');
        }
        if (!object(value))
            throw new PartyTymeError('invalid-response');
        if (value.error)
            throw new PartyTymeError(action === 'authenticate' ? 'credentials' : 'expired');
        return value;
    }
    private async validate(record: PartyTymeMaterial, signal: AbortSignal): Promise<boolean> {
        const data = await this.api('getconfiguration', {}, record, signal);
        const user = Array.isArray(data.objects) ? data.objects.find(value => object(value) && value.type === 'user') : null;
        if (!object(user) || !text(user.user_permission, 1000))
            throw new PartyTymeError('expired');
        return user.user_permission.split(',').map(value => value.trim()).includes('PR');
    }
    /** A selected credential file is read by main only. Passwords are never saved. */
    connect(credentials: {
        username: string;
        password: string;
    }): Promise<PartyTymeStatus> {
        if (this.pending)
            return this.pending;
        const controller = new AbortController();
        this.controller = controller;
        const signal = this.signal(controller.signal);
        this.live = null;
        this.scope = null;
        this.publish({ state: 'connecting', premium: false, persistence: 'memory-only' });
        const revision = this.revision();
        const operation = (async () => {
            try {
                await this.deps.vault?.clear();
                signal.throwIfAborted();
                const html = await this.get(PARTY_TYME_SITE + '/', signal, 1024 * 1024);
                const block = /<script[^>]*data-drupal-selector=['"]drupal-settings-json['"][^>]*>([\s\S]*?)<\/script>/i.exec(html);
                let config: unknown;
                try {
                    config = block && JSON.parse(block[1]);
                }
                catch {
                    throw new PartyTymeError('invalid-response');
                }
                const options = object(config) && object(config.codesbasePublic) && object(config.codesbasePublic.options) ? config.codesbasePublic.options : null;
                if (!options || options.api !== PARTY_TYME_API || !text(options.version, 20))
                    throw new PartyTymeError('invalid-response');
                // The consumer site's form serializes fields before its normal POST.
                // Preserve that observed encoding, including passwords containing + or @.
                const encode = (v: string) => new URLSearchParams({ v }).toString().slice(2);
                const configRecord = {
                    version: options.version, ...(text(options.cs_auth_token, 2048) ? { clientToken: options.cs_auth_token } : {})
                };
                if (!text(credentials.username, 500) || typeof credentials.password !== 'string' || !credentials.password || credentials.password.length > 4096)
                    throw new PartyTymeError('credentials');
                const reply = await this.api('authenticate', { username: encode(credentials.username), password: encode(credentials.password) }, configRecord, signal);
                const record = material({ ...configRecord, authToken: reply.auth_token }), premium = await this.validate(record, signal), scope = randomBytes(32).toString('hex');
                if (signal.aborted || revision !== this.revision())
                    return this.status();
                // Reuse the existing hardened opaque OS vault in a separate Party Tyme
                // file. The payload is typed here; no KaraFun account data is shared.
                let remembered = false;
                try {
                    remembered = await this.deps.vault?.save({ sessionKey: Buffer.from(JSON.stringify(record)).toString('base64url'), accountScope: scope }, signal) ?? false;
                }
                catch {
                }
                if (signal.aborted || revision !== this.revision()) {
                    if (remembered)
                        await this.deps.vault?.clear(scope);
                    return this.status();
                }
                this.live = record;
                this.scope = scope;
                this.publish({ state: 'connected', premium, persistence: remembered ? 'os-protected' : 'memory-only' });
            }
            catch (error) {
                if (revision === this.revision())
                    this.publish({
                        state: 'disconnected', premium: false, message: error instanceof PartyTymeError ? error.message : new PartyTymeError('unavailable').message
                    });
            }
            finally {
                if (this.controller === controller)
                    this.controller = null;
            }
            return this.status();
        })();
        this.pending = operation;
        void operation.finally(() => {
            if (this.pending === operation)
                this.pending = null;
        });
        return operation;
    }
    async restore(): Promise<PartyTymeStatus> {
        if (!this.deps.vault || this.pending || this.live)
            return this.status();
        const revision = this.revision(), controller = new AbortController();
        this.controller = controller;
        try {
            const saved = await this.deps.vault.load(controller.signal);
            if (!saved)
                return this.status();
            const record = material(JSON.parse(Buffer.from(saved.sessionKey, 'base64url').toString('utf8'))), premium = await this.validate(record, this.signal(controller.signal));
            if (revision !== this.revision() || controller.signal.aborted)
                return this.status();
            this.live = record;
            this.scope = saved.accountScope;
            this.publish({ state: 'connected', premium, persistence: 'os-protected' });
        }
        catch (error) {
            if (revision === this.revision())
                this.publish({
                    state: 'disconnected', premium: false, message: error instanceof PartyTymeError ? error.message : 'Saved Party Tyme sign-in could not be opened. Reconnect in Sources.'
                });
        }
        finally {
            if (this.controller === controller)
                this.controller = null;
        }
        return this.status();
    }
    async disconnect(): Promise<PartyTymeStatus> {
        this.controller?.abort();
        this.pending = null;
        this.live = null;
        this.scope = null;
        // Queue forgetting before a new connection can publish its own vault entry.
        const clear = this.deps.vault?.clear();
        this.publish({ state: 'disconnected', premium: false, persistence: 'memory-only' });
        try {
            await clear;
        }
        catch {
            this.publish({ message: 'Signed out for this launch. Saved sign-in could not be removed.' });
        }
        return this.status();
    }
    close(): void {
        this.controller?.abort();
        this.live = null;
        this.scope = null;
        this.publish({ state: 'disconnected', premium: false });
    }
    private async guarded<T>(work: (record: PartyTymeMaterial, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
        const record = this.live, revision = this.revision();
        if (!record)
            throw new PartyTymeError('expired');
        try {
            const result = await work(record, this.signal(signal));
            if (revision !== this.revision() || record !== this.live)
                throw new PartyTymeError('expired');
            return result;
        }
        catch (error) {
            if (error instanceof PartyTymeError && error.code === 'expired' && revision === this.revision()) {
                this.live = null;
                this.scope = null;
                this.publish({ state: 'expired', premium: false });
            }
            throw error;
        }
    }
    search(query: string, signal?: AbortSignal): Promise<PartyTymeSong[]> {
        if (typeof query !== 'string' || query.trim().length < 2 || query.length > 200 || /[\x00-\x1f\x7f]/.test(query))
            return Promise.resolve([]);
        return this.guarded(async (record, combined) => partyTymeSongs(await this.api('search', { key: query.trim(), object_type: 'video', video_type: 'non_episode', start: '0', max: '100' }, record, combined)), signal);
    }
    requestMedia(videoId: string, signal?: AbortSignal): Promise<PartyTymeAuthorization> {
        if (!partyTymeId(videoId))
            throw new PartyTymeError('invalid-response');
        return this.guarded(async (record, combined) => {
            const premium = await this.validate(record, combined);
            if (!premium) {
                if (this.current.premium)
                    this.publish({ premium: false });
                throw new PartyTymeError('not-entitled');
            }
            const result = await this.api('search', { id: videoId, object_type: 'video' }, record, combined);
            const song = Array.isArray(result.objects) && result.objects.find(item => object(item) && item.id === videoId && item.type === 'video');
            if (!object(song) || song.drm !== 'false' && song.drm !== false)
                throw new PartyTymeError('not-entitled');
            const params = new URLSearchParams({
                version: record.version, auth_token: record.authToken, ...(record.clientToken ? { cs_auth_token: record.clientToken } : {}), device_type: 'desktop', platform: 'web', partner: 'internal', language: 'en', permissions: 'PR', id: videoId, div_id: 'video_player', mute: 'true', image_width: '1280', content_page_url: encodeURIComponent(PARTY_TYME_SITE + '/node/' + videoId), timestamp: String(Math.floor(Date.now() / 1000))
            });
            const source = partyTymeProgressive(await this.get(PARTY_TYME_API + '/embeddedVideoPlayer?' + params.toString(), combined, 512 * 1024));
            return { ...source, revision: this.revision(), accountScope: this.scope! };
        }, signal);
    }
}
