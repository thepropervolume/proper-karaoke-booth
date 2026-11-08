/** Proposed host-only bridge. No implementation or listener is started by this module. */
export type RemoteInterface = { id: string; label: string };
export type SelectedFile = { token: string; label: string };
export type RemoteGuest = { singerId: string; name: string };
export type HostRemoteStatus = { room: 'closed' | 'opening' | 'open' | 'closing' | 'failed';
  available: boolean; roomId: string | null; lanOrigin: string | null; guests: RemoteGuest[]; message: string; interfaces: RemoteInterface[] };
export type OpenLanInput = { interfaceId: string; hostname: string; port: number; certificateToken: string; privateKeyToken: string };
export type HostRemoteBridge = {
  status(): Promise<HostRemoteStatus>;
  subscribe(callback: (status: HostRemoteStatus) => void): () => void;
  chooseCertificate(): Promise<SelectedFile | null>;
  choosePrivateKey(): Promise<SelectedFile | null>;
  openLan(input: OpenLanInput): Promise<void>;
  closeRoom(): Promise<void>;
  createInvitation(ttlSeconds: number): Promise<string>;
  revokeInvitations(): Promise<void>;
  revokeGuest(singerId: string): Promise<void>;
};

/** UI validation improves feedback; the main-process authority must independently validate everything. */
export function validateOpenLan(input: OpenLanInput, interfaces: RemoteInterface[]): string | null {
  if (!interfaces.some(item => item.id === input.interfaceId)) return 'Choose an available local network interface.';
  let validHostname = !!input.hostname && input.hostname === input.hostname.toLowerCase() && input.hostname.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(input.hostname) && !input.hostname.includes('..');
  if (input.hostname.includes(':') && input.hostname === input.hostname.toLowerCase()) {
    try { const address = new URL(`https://[${input.hostname}]/`); validHostname = address.hostname.startsWith('['); } catch { validHostname = false; }
  }
  if (!validHostname) return 'Enter a valid lowercase hostname or IP address covered by the certificate.';
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) return 'Enter a port from 1 to 65535.';
  if (!input.certificateToken || !input.privateKeyToken) return 'Choose a certificate and private key.';
  return null;
}

/** Keep admission secrets only in a URL fragment on the active HTTPS origin. */
export function validInvitation(link: string, origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(link), expected = new URL(origin);
    const fragment = new URLSearchParams(url.hash.slice(1));
    return expected.protocol === 'https:' && expected.origin === origin && url.origin === origin && !url.username && !url.password && !url.search &&
      url.pathname === '/singer/' && [...fragment.keys()].length === 1 && /^[A-Za-z0-9_-]{43}$/.test(fragment.get('invite') ?? '');
  } catch { return false; }
}
