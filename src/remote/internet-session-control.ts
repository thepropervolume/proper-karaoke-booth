/** Host-only view of an internet session. Owner credentials never cross this bridge. */
export const INTERNET_QUEUE_ORIGIN = 'https://queue.thepropervolume.com';
export type InternetSessionStatus = {
  available: boolean;
  state: 'stopped' | 'starting' | 'online' | 'reconnecting' | 'stopping' | 'failed';
  suggestedSlug: string;
  slug: string | null;
  joinUrl: string | null;
  guests: { singerId: string; name: string }[];
  message: string;
  screenActive?: boolean;
  screenUrl?: string | null;
};
export type InternetSessionBridge = {
  status(): Promise<InternetSessionStatus>;
  subscribe(callback: (status: InternetSessionStatus) => void): () => void;
  start(input: { slug: string }): Promise<void>;
  stop(): Promise<void>;
  copyLink(): Promise<void>;
  revokeGuest(singerId: string): Promise<void>;
  startScreen?(): Promise<void>;
  stopScreen?(): Promise<void>;
  copyScreenLink?(): Promise<void>;
};

export function validateSessionSlug(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 3 || value.length > 48 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value))
    return 'Use 3–48 lowercase letters, numbers or hyphens, with a letter or number at each end.';
  if (new Set(['api', 'v1', 'assets', 'singer', 'healthz', 'admin', 'host', 'login', 'logout', 'account', 'settings', 'status', 'help', 'support', 'robots', 'favicon', 'app', 'mobile']).has(value))
    return 'That session name is reserved. Choose another name.';
  return null;
}

export function validSessionLink(value: unknown, slug: string | null): value is string {
  return typeof value === 'string' && typeof slug === 'string' && !validateSessionSlug(slug) && value === `${INTERNET_QUEUE_ORIGIN}/${slug}`;
}
