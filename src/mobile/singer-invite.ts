import { Capacitor, registerPlugin } from '@capacitor/core';
import { validateSessionSlug } from '../remote/internet-session-control';
import { MOBILE_ORIGIN } from './api';

const nativeShare = registerPlugin<{ share(options: { title: string; text: string; url: string; dialogTitle: string }): Promise<unknown> }>('Share');
const nativeBrowser = registerPlugin<{ open(options: { url: string }): Promise<void> }>('Browser');
export const CUSTOM_REQUEST_URL = 'https://thepropervolume.com/song-request/';

/** Generate an ordinary public join invitation. The slug is the only room data shared. */
export function singerInvite(slug: string, name: string) {
  if (validateSessionSlug(slug)) return null;
  const room = name.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 100) || slug;
  const url = new URL('/app/', MOBILE_ORIGIN);
  url.searchParams.set('room', slug);
  return { title: 'Karaoke Room Invitation', text: 'Join me for karaoke in ' + room + '!', url: url.href };
}

export type SingerInvite = NonNullable<ReturnType<typeof singerInvite>>;

export const invitationMessage = (invite: SingerInvite) => invite.text + '\n' + invite.url;

export function canShareInvitation() {
  return Capacitor.isPluginAvailable('Share') || typeof navigator.share === 'function';
}

export async function shareSingerInvite(invite: SingerInvite) {
  if (Capacitor.isPluginAvailable('Share')) {
    await nativeShare.share({ ...invite, dialogTitle: 'Invite to Karaoke' });
  } else {
    await navigator.share({ text: invitationMessage(invite) });
  }
}

export function openNativeSongRequest(): Promise<void> | null {
  return Capacitor.isPluginAvailable('Browser') ? nativeBrowser.open({ url: CUSTOM_REQUEST_URL }) : null;
}
