import { useEffect, useState, type FormEvent } from 'react';
import { IonButton, IonIcon } from '@ionic/react';
import { personCircleOutline } from 'ionicons/icons';
import { EMPTY_SINGER_PROFILE, MAX_PROFILE_AVATAR_BYTES, parseSingerProfileDetails, type SingerProfileDetails } from '../domain/singer-profile-details';
import { prepareGuestPhoto } from '../remote/photo';
import { mobileJson } from './api';

const profilePath = '/v1/mobile/account/profile';

function fromServer(result: unknown) {
  const profile = parseSingerProfileDetails((result as { profile?: unknown } | null)?.profile);
  if (!profile) throw new Error('Profile data is unavailable.');
  return profile;
}

export function SingerProfileDetailsEditor({ token }: { token: string }) {
  const [draft, setDraft] = useState<SingerProfileDetails>(EMPTY_SINGER_PROFILE);
  const [ready, setReady] = useState(false);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void mobileJson(profilePath, undefined, { token, signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const profile = fromServer(result);
      setDraft(profile);
      setReady(true);
      setMessage('');
    }).catch(() => {
      if (!controller.signal.aborted) setMessage('Your profile service is unavailable. Try again.');
    });
    return () => controller.abort();
  }, [token, attempt]);

  async function selectPhoto(file: File) {
    setBusy(true);
    setMessage('');
    try {
      const avatar = await prepareGuestPhoto(file, { maxDimension: 320, maxBytes: MAX_PROFILE_AVATAR_BYTES });
      setDraft(previous => ({ ...previous, avatar }));
      setEdited(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Couldn’t prepare your profile photo.');
    } finally { setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setMessage('');
    try {
      const profile = fromServer(await mobileJson(profilePath, draft, { token }));
      setDraft(profile);
      setEdited(false);
      setMessage('Profile saved.');
    } catch { setMessage('Couldn’t save your profile. Try again.'); }
    finally { setBusy(false); }
  }

  return <details className="singer-profile-details">
    <summary>Singing Profile</summary>
    <form onSubmit={event => void save(event)}>
      <div className="singer-profile-photo">
        {draft.avatar ? <img src={draft.avatar} alt="Your profile photo" width="64" height="64" /> : <IonIcon icon={personCircleOutline} aria-hidden="true" />}
        <label>Profile photo<input type="file" accept="image/jpeg,image/png" disabled={!ready || busy} onChange={event => {
          const file = event.target.files?.item(0);
          event.target.value = '';
          if (file) void selectPhoto(file);
        }} /></label>
      </div>
      {draft.avatar && <IonButton type="button" fill="clear" disabled={busy || !ready} onClick={() => {
        setDraft({ ...draft, avatar: null });
        setEdited(true);
      }}>Remove Photo</IonButton>}
      <label>Pronouns<input value={draft.pronouns} maxLength={32} disabled={busy || !ready}
        onChange={event => { setDraft({ ...draft, pronouns: event.target.value }); setEdited(true); }} /></label>
      <label>Bio<input value={draft.bio} maxLength={160} disabled={busy || !ready}
        onChange={event => { setDraft({ ...draft, bio: event.target.value }); setEdited(true); }} /></label>
      {ready && <IonButton type="submit" shape="round" disabled={busy || !edited}>Save Singing Profile</IonButton>}
      {!ready && message && <IonButton type="button" fill="outline" shape="round" onClick={() => {
        setMessage('');
        setAttempt(value => value + 1);
      }}>Try Again</IonButton>}
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
