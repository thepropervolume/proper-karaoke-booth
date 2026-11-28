import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { roomShareUrl } from '../domain/booth-workspace-settings';
import type { InternetSessionBridge, InternetSessionStatus } from '../remote/internet-session-control';
import { Tooltip } from './Tooltip';

export function RoomShareCard({ bridge, override, enabled }: { bridge: InternetSessionBridge; override: string; enabled: boolean }) {
  const [status, setStatus] = useState<InternetSessionStatus | null>(null);
  const [code, setCode] = useState<{ url: string; src: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (!enabled) { setStatus(null); return; }
    let active = true, received = false;
    const unsubscribe = bridge.subscribe(value => { received = true; if (active) setStatus(value); });
    void bridge.status().then(value => { if (active && !received) setStatus(value); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge, enabled]);
  const url = enabled ? roomShareUrl(status, override) : null;
  useEffect(() => {
    setFeedback('');
    if (!url) return;
    let active = true;
    void QRCode.toDataURL(url, { width: 240, margin: 4, errorCorrectionLevel: 'M' }).then(src => {
      if (active) setCode({ url, src });
    }).catch(() => {});
    return () => { active = false; };
  }, [url]);
  if (!url) return null;
  return <div className="room-share-card">
    <Tooltip text="Copy the public QR destination to your clipboard">
      <button type="button" className="room-share-card__button" aria-label="Copy public room link" onClick={() => {
        void (bridge.copyShareLink?.() ?? Promise.reject()).then(() => setFeedback('Room link copied.'))
          .catch(() => setFeedback('Could not copy the room link.'));
      }}>
        {code?.url === url && <img alt="" src={code.src} width="112" height="112" />}
        <span>Copy room link</span>
      </button>
    </Tooltip>
    <span className="room-share-card__status" role="status">{feedback}</span>
  </div>;
}
