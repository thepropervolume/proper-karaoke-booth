import { randomUUID } from 'node:crypto';
import type { BrowserWindow, Session } from 'electron';
import { KaraFunAccountError, type KaraFunAccountSession } from './karafun-account';
import { karaFunEnvelopeOk, karaFunSessionKey, parseKaraFunXml } from './karafun-account-protocol';

type Options = { show?: boolean; timeoutMs?: number; onWindow?: (window: BrowserWindow, session: Session) => Promise<void> };
/** Official first-party browser sign-in creates its own session. No vendor app key,
 * password transform, credential-file access, preload or renderer API is supplied. */
export async function authenticateKaraFunAccount(parent?: BrowserWindow, signal?: AbortSignal, options: Options = {}): Promise<KaraFunAccountSession> {
  signal?.throwIfAborted();
  const { BrowserWindow: Window, session } = await import('electron');
  const isolated = session.fromPartition(`tpv-karafun-sign-in-${randomUUID()}`, { cache: false });
  let loginFormSubmitted = false, accountRedirects = 0;
  isolated.setPermissionRequestHandler((_window, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  // The sign-in window cannot play a song, create a remote room or change billing.
  isolated.webRequest.onBeforeRequest((details, callback) => {
    let cancel = false;
    try {
      const url = new URL(details.url);
      if (['ws:', 'wss:'].includes(url.protocol) || details.resourceType === 'media' || /\.(?:kit|kfn|mp3|ogg|mp4|m3u8)$/i.test(url.pathname)) cancel = true;
      if (url.hostname === 'api.karafun.com') {
        cancel ||= ['/song/request', '/community/request', '/session/remote'].includes(url.pathname) || url.pathname.startsWith('/search/');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(details.method)) cancel ||= url.pathname !== '/session/open';
      } else if (!['GET', 'HEAD', 'OPTIONS'].includes(details.method)) {
        const normalLogin = url.hostname === 'www.karafun.com' && url.pathname === '/my/loginv.html' && details.method === 'POST';
        if (normalLogin) loginFormSubmitted = true;
        cancel ||= !normalLogin;
      }
    } catch { cancel = true; }
    callback({ cancel });
  });
  const window = new Window({ title: 'Connect KaraFun', width: 1100, height: 800, show: options.show !== false,
    ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, session: isolated, webSecurity: true } });
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', (event, destination) => { try { const url = new URL(destination); if (url.protocol !== 'https:' || !['www.karafun.com', 'karafun.com'].includes(url.hostname)) event.preventDefault(); } catch { event.preventDefault(); } });
  window.webContents.setUserAgent(`TheProperVolumeKaraokeBooth (account connection) ${window.webContents.getUserAgent()}`);
  let settled = false, active = true, timer: ReturnType<typeof setTimeout> | undefined;
  const requests = new Map<string, { clientId?: string; accountLoginPresent: boolean }>();
  const dispose = async () => {
    active = false;
    try { if (!window.isDestroyed()) { if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach(); window.destroy(); } } catch {}
    try { await isolated.clearStorageData(); await isolated.clearCache(); } catch {}
  };
  let accept!: (value: KaraFunAccountSession) => void, refuse!: (error: KaraFunAccountError) => void;
  const result = new Promise<KaraFunAccountSession>((resolve, reject) => { accept = resolve; refuse = reject; });
  const fail = (code: 'cancelled' | 'unavailable' | 'invalid-response' = 'unavailable') => {
    if (settled) return; settled = true; if (timer) clearTimeout(timer); signal?.removeEventListener('abort', cancelled);
    refuse(new KaraFunAccountError(code, code === 'cancelled' ? 'KaraFun sign-in was cancelled.' : code === 'invalid-response' ? 'KaraFun sign-in returned an unsupported response.' : 'KaraFun sign-in could not complete. Use the official sign-in page and retry.'));
    void dispose();
  };
  const cancelled = () => fail('cancelled');
  window.on('closed', cancelled); signal?.addEventListener('abort', cancelled, { once: true });
  timer = setTimeout(() => fail('unavailable'), options.timeoutMs ?? 180_000);
  window.webContents.debugger.on('message', async (_event, method, params) => {
    if (!active || settled) return;
    try {
      if (method === 'Network.requestWillBeSent') {
        const url = new URL(params.request.url);
        if (url.origin !== 'https://api.karafun.com' || url.pathname !== '/session/open' || !['GET', 'POST'].includes(params.request.method)) return;
        let login = url.searchParams.get('login');
        if (!login && typeof params.request.postData === 'string' && params.request.postData.length <= 16_384) login = new URLSearchParams(params.request.postData).get('login');
        const client = url.searchParams.get('client');
        requests.set(params.requestId, { accountLoginPresent: typeof login === 'string' && login.trim().length > 0,
          ...(client && /^\d{1,5}$/.test(client) ? { clientId: client } : {}) });
      } else if (method === 'Network.responseReceived') {
        const url = new URL(params.response.url);
        if ([401, 403, 429].includes(params.response.status) && (requests.has(params.requestId) || url.hostname === 'www.karafun.com' && params.type === 'Document')) fail('unavailable');
      } else if (method === 'Network.loadingFinished') {
        const request = requests.get(params.requestId); if (!request) return; requests.delete(params.requestId);
        if (!request.accountLoginPresent) return; // Never connect TPV to an anonymous browsing session.
        const response = await window.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        if (!active || settled) return;
        const body = response.base64Encoded ? Buffer.from(response.body, 'base64').toString('utf8') : response.body;
        if (typeof body !== 'string' || Buffer.byteLength(body) > 512 * 1024) return fail('invalid-response');
        const xml = parseKaraFunXml(body), key = karaFunSessionKey(xml);
        if (!karaFunEnvelopeOk(xml) || !key) return fail('unavailable');
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancelled);
        try { if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach(); } catch {}
        accept({ sessionKey: key, ...(request.clientId ? { clientId: request.clientId } : {}), dispose });
        if (!window.isDestroyed()) window.close();
      }
    } catch { fail('invalid-response'); }
  });
  // Some accounts land on My Account after the normal form instead of backurl.
  const failedNavigation = (error: unknown) => {
    const value = error as { code?: unknown; errno?: unknown } | null;
    if ((value?.code === 'ERR_ABORTED' || value?.errno === -3) && (loginFormSubmitted || accountRedirects > 0)) return;
    fail();
  };
  window.webContents.on('did-navigate', (_event, destination) => {
    if (!active || settled) return;
    try {
      const url = new URL(destination);
      if (loginFormSubmitted && url.origin === 'https://www.karafun.com' && !url.search && !url.hash && ['/', '/my/', '/my/index.html'].includes(url.pathname) && accountRedirects++ < 1)
        void window.loadURL('https://www.karafun.com/web/discover/').catch(failedNavigation);
    } catch {}
  });
  try {
    await window.loadURL('about:blank');
    if (!active || settled) return result;
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 2 * 1024 * 1024, maxResourceBufferSize: 512 * 1024 });
    if (!active || settled) return result;
    await options.onWindow?.(window, isolated);
    if (!active || settled) return result;
    void window.loadURL('https://www.karafun.com/my/login.html?backurl=%2Fweb%2Fdiscover%2F').catch(failedNavigation);
  } catch { fail('unavailable'); }
  return result;
}
