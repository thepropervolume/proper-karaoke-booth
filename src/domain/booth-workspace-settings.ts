import { validateSessionSlug, validSessionLink, type InternetSessionStatus } from '../remote/internet-session-control';

export const HOST_ZOOM_LEVELS = [80, 90, 100, 110, 120, 130, 140] as const;
export type HostZoom = (typeof HOST_ZOOM_LEVELS)[number];
export type BoothWorkspaceSettings = {
  hostHandle: string;
  hostSetupPending: boolean;
  hostZoom: HostZoom;
  showRoomQr: boolean;
  roomQrUrl: string;
};
export const DEFAULT_BOOTH_WORKSPACE: BoothWorkspaceSettings = {
  hostHandle: '', hostSetupPending: false, hostZoom: 100, showRoomQr: true, roomQrUrl: '',
};

export function publicRoomUrl(value: string): string | null {
  if (value.length > 500 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function validateBoothWorkspace(value: Record<string, unknown>): void {
  if (typeof value.hostSetupPending !== 'boolean' || typeof value.hostHandle !== 'string' ||
      value.hostHandle !== '' && validateSessionSlug(value.hostHandle))
    throw new Error('Choose a host handle with 3–48 lowercase letters, numbers and internal hyphens.');
  if (typeof value.hostZoom !== 'number' || !HOST_ZOOM_LEVELS.includes(value.hostZoom as HostZoom))
    throw new Error('Choose a supported host zoom between 80% and 140%.');
  if (typeof value.showRoomQr !== 'boolean' || typeof value.roomQrUrl !== 'string' || value.roomQrUrl !== '' && !publicRoomUrl(value.roomQrUrl))
    throw new Error('Enter a public HTTP or HTTPS address for the room QR code.');
}

export function roomShareUrl(status: InternetSessionStatus | null, override: string): string | null {
  if (status?.state !== 'online' || !validSessionLink(status.joinUrl, status.slug)) return null;
  return override ? publicRoomUrl(override) : status.joinUrl;
}
