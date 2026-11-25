import { useEffect, useState } from 'react';
import { IonToggle } from '@ionic/react';
import type { GuestNowPlaying } from '../domain/guest-stage';
import { clearNativeLiveActivity, getNativeLiveActivityStatus, updateNativeLiveActivity, type NativeLiveActivityStatus } from './native-live-activity';
import './singer-extras.css';

const setting = 'tpv-singer-lock-screen';

function storedLockScreen() {
  try { return localStorage.getItem(setting) === 'yes'; }
  catch { return false; }
}

export function useSingerLiveActivity(allowed: boolean, room: string, playing: GuestNowPlaying | null | undefined) {
  const [enabled, setEnabled] = useState(storedLockScreen);
  const [status, setStatus] = useState<NativeLiveActivityStatus>('unsupported');

  useEffect(() => {
    let current = true;
    const check = () => void getNativeLiveActivityStatus().then(value => { if (current) setStatus(value); });
    check();
    window.addEventListener('focus', check);
    return () => {
      current = false;
      window.removeEventListener('focus', check);
    };
  }, []);
  useEffect(() => {
    if (allowed && enabled && status === 'available' && playing)
      void updateNativeLiveActivity(room, playing);
    else void clearNativeLiveActivity();
  }, [allowed, enabled, status, room, playing]);
  useEffect(() => () => { void clearNativeLiveActivity(); }, []);

  return { enabled, status, setEnabled(value: boolean) {
    try { localStorage.setItem(setting, value ? 'yes' : 'no'); } catch { /* The choice still applies this session. */ }
    setEnabled(value);
  } };
}

export function SingerLiveActivitySetting({ controller }: { controller: ReturnType<typeof useSingerLiveActivity> }) {
  const { enabled, status, setEnabled } = controller;
  return <div className="singer-live-setting">
    <IonToggle checked={enabled} disabled={status !== 'available' && !enabled}
      onIonChange={event => setEnabled(event.detail.checked)}>Now Playing on Lock Screen</IonToggle>
    <p className="mobile-quiet">{status === 'unsupported' ? 'Lock-screen status isn’t available in this build.' :
      status === 'blocked' ? 'Allow Booth notifications in your device settings to show room status.' :
        'See the host’s current song. Status expires when Booth stops receiving room updates.'}</p>
  </div>;
}
