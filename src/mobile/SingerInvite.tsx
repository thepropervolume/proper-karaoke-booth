import { useState } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { copyOutline, openOutline, shareOutline } from 'ionicons/icons';
import { canShareInvitation, CUSTOM_REQUEST_URL, invitationMessage, openNativeSongRequest, shareSingerInvite, singerInvite } from './singer-invite';

export function SingerInviteActions({ slug, name }: { slug: string; name: string }) {
  const invite = singerInvite(slug, name);
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState(false);
  if (!invite) return null;
  const text = invitationMessage(invite);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Invitation copied.');
    } catch {
      setManual(true);
      setMessage('Copy the invitation from the message below.');
    }
  }

  return <div className="singer-invite-actions">
    {canShareInvitation() && <IonButton shape="round" onClick={() => {
      setMessage('');
      void shareSingerInvite(invite).catch(error => {
        if (error?.name !== 'AbortError' && !/cancel/i.test(String(error?.message ?? ''))) {
          setManual(true);
          setMessage('Copy this invitation and send it through Messages.');
        }
      });
    }}><IonIcon icon={shareOutline} slot="start" aria-hidden="true" /> Invite to Room</IonButton>}
    <IonButton shape="round" fill="outline" onClick={() => void copy()}>
      <IonIcon icon={copyOutline} slot="start" aria-hidden="true" /> Copy Invitation
    </IonButton>
    {manual && <label className="singer-invite-manual">Invitation message<textarea value={text} rows={3} readOnly onFocus={event => event.currentTarget.select()} /></label>}
    {message && <p role="status">{message}</p>}
  </div>;
}

export function CustomSongRequestAction() {
  const [failed, setFailed] = useState(false);
  return <>
    <IonButton href={CUSTOM_REQUEST_URL} target="_blank" rel="noopener noreferrer" shape="round" fill="outline" onClick={event => {
      const native = openNativeSongRequest();
      if (!native) return;
      event.preventDefault();
      setFailed(false);
      void native.catch(() => setFailed(true));
    }}><IonIcon icon={openOutline} slot="start" aria-hidden="true" /> Request a Custom Song</IonButton>
    {failed && <p role="status">Couldn’t open the form. <a href={CUSTOM_REQUEST_URL} target="_blank" rel="noopener noreferrer">Open the TPV request form in your browser.</a></p>}
  </>;
}
