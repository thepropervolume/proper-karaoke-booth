import React, { useEffect, useRef, useState } from 'react';
import type { SongRatingsLookup } from '../main/song-ratings-client';
import { Tooltip } from './Tooltip';

/** Draft-only profile selection. Saving the surrounding Preferences applies it. */
export function RatingProfileControls({ configFile, onChange }: {configFile:string;onChange:(path:string)=>void}) {
  const [result,setResult] = useState<SongRatingsLookup | null>(null);
  const [checking,setChecking] = useState(false);
  const [choosing,setChoosing] = useState(false);
  const sequence = useRef(0);
  useEffect(() => { ++sequence.current; setResult(null); setChecking(false); },[configFile]);
  useEffect(() => () => { ++sequence.current; },[]);
  const check = async () => {
    const request = ++sequence.current;
    setChecking(true);setResult(null);
    try {
      const status = await window.tpv.ratingProfileStatus(configFile || undefined);
      if (sequence.current === request) setResult(status);
    } catch { if (sequence.current === request) setResult({status:'unavailable'}); }
    finally { if (sequence.current === request) setChecking(false); }
  };
  const choose = async () => {
    setChoosing(true);setResult(null);
    try { const file = await window.tpv.chooseRatingProfile(); if (file) onChange(file); }
    catch { setResult({status:'configuration-error'}); }
    finally { setChoosing(false); }
  };
  const messages: Record<string,string> = {
    'configuration-error':'This host rating profile cannot be read or is invalid. Choose the dedicated voter configuration supplied for this host. On Linux, it must belong to your user and have mode 600.',
    'configuration-required':'Choose a dedicated host voter profile to submit Your host rating. Public aggregate ratings remain read-only.',
    unauthorized:'The rating service rejected this profile. Replace its dedicated host voter credentials.',
    forbidden:'This profile is not permitted to vote. A catalog-reader profile cannot be used as a host rating profile.',
    unavailable:'The rating service could not be reached. Your local songs and queue are still available.',
    'timed-out':'The rating service did not respond in time. Try checking again.',
    'rate-limited':'The rating service is busy. Wait before checking again.',
    'invalid-response':'The rating service returned an unsupported response. The profile was not confirmed.',
    'invalid-request':'The rating profile check could not be completed.',
  };
  const busy = checking || choosing;
  return <div className="rating-profile-controls">
    <p>Community ratings use 1–10 hearts. <strong>Your host rating</strong> belongs to a separately provisioned host voting profile; it is not a singer account.</p>
    <Tooltip text={configFile || 'Uses rating-connection.json in this app’s data folder when present; otherwise public aggregate ratings only.'}>
      <button type="button" disabled={busy} onClick={() => void choose()}>{choosing ? 'Choosing…' : configFile ? `Profile: ${configFile.split(/[\\/]/).pop()}` : 'Choose Host Rating Profile…'}</button>
    </Tooltip>{' '}
    <button type="button" disabled={busy || !configFile} onClick={() => onChange('')}>Use Default Profile</button>{' '}
    <button type="button" disabled={busy} onClick={() => void check()}>{checking ? 'Checking…' : 'Check Rating Profile'}</button>
    {result?.status === 'ready' ? <p role="status">{result.canVote
      ? 'Host voting profile connected. You can set or clear Your host rating.'
      : 'Public aggregate ratings connected. No host voter profile is configured, so voting is unavailable.'}</p>
      : result && <p role="status">{messages[result.status] || 'The rating profile is not available.'}</p>}
    <p className="muted">Choose or check a profile without changing the running show. Save Preferences to apply your selection. Without a private profile, an installed default profile is used if available; otherwise ratings are read-only. Keep the dedicated token private; catalog-reader credentials do not grant voting access.</p>
  </div>;
}
