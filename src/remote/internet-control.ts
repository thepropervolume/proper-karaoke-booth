/** Proposed host-only bridge. This contract does not start or connect a relay. */
export type InternetRelayStatus = {
  available: boolean;
  state: 'stopped' | 'starting' | 'online' | 'stopping' | 'failed';
  roomId: string | null;
  origin: string | null;
  connector: { state: 'missing' | 'unverified' | 'verified'; label: string };
  loopbackTls: 'unavailable' | 'ready';
  message: string;
  guests: { id: string; name: string }[];
};
export type InternetRelayBridge = {
  status(): Promise<InternetRelayStatus>;
  subscribe(callback: (status: InternetRelayStatus) => void): () => void;
  /** Host-selected local executable; no path or file bytes cross the bridge. */
  chooseConnector(): Promise<void>;
  /** Prepares an ephemeral loopback-only identity; never installs a system root. */
  prepareLoopbackTls(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createInvitation(ttlSeconds: number): Promise<string>;
  revokeInvitations(): Promise<void>;
  revokeGuest(id: string): Promise<void>;
};

/** Share only an exact HTTPS relay origin, with the admission secret in its fragment. */
export function validInternetInvitation(link: string, origin: string | null): boolean {
  if (!origin) return false;
  try {
    const endpoint = new URL(origin), url = new URL(link), fragment = new URLSearchParams(url.hash.slice(1));
    return endpoint.protocol === 'https:' && endpoint.origin === origin && !endpoint.port &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(endpoint.hostname) &&
      url.origin === origin && !url.username && !url.password && !url.search && url.pathname === '/singer/' &&
      [...fragment.keys()].length === 1 && /^[A-Za-z0-9_-]{43}$/.test(fragment.get('invite') ?? '');
  } catch { return false; }
}
