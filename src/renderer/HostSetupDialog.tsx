import React, { useEffect, useRef, useState } from 'react';
import { validateSessionSlug } from '../remote/internet-session-control';
import type { Settings } from '../domain/settings';

export function HostSetupDialog({ save }: { save: (patch: Partial<Settings>) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [brand, setBrand] = useState('');
  const [handle, setHandle] = useState('');
  const [feedback, setFeedback] = useState('');
  const [working, setWorking] = useState(false);
  const offerLocalApi = !navigator.userAgent.includes('Windows');
  const [enableLocalApi, setEnableLocalApi] = useState(true);
  useEffect(() => {
    const window = dialog.current;
    window?.showModal();
    return () => { if (window?.open) window.close(); };
  }, []);

  return <dialog ref={dialog} className="settings-dialog host-setup" aria-labelledby="host-setup-title" onCancel={event => event.preventDefault()}>
    <form onSubmit={event => {
      event.preventDefault();
      if (working) return;
      const boothName = brand.trim(), hostHandle = handle.trim().toLowerCase();
      const issue = validateSessionSlug(hostHandle);
      if (!boothName || issue) { setFeedback(!boothName ? 'Enter your DJ or brand name.' : issue!); return; }
      setWorking(true); setFeedback('');
      void save({ boothName, hostHandle, hostSetupPending: false, ...(offerLocalApi && { localControlEnabled: enableLocalApi }) }).catch(() => {
        setFeedback('Could not save your host details. Check that KaraBooth can write to its settings.');
        setWorking(false);
      });
    }}>
      <h2 id="host-setup-title">Set up KaraBooth</h2>
      <label>DJ or brand name<input autoFocus value={brand} onChange={event => setBrand(event.target.value)} required maxLength={120} /></label>
      <label>Host handle<input value={handle} onChange={event => setHandle(event.target.value.toLowerCase())} autoCapitalize="none"
        spellCheck={false} required minLength={3} maxLength={48} placeholder="your-brand" /></label>
      <p>Choose a short handle for your room. KaraBooth checks whether the room address is available when you start an internet session.</p>
      {offerLocalApi && <label><input type="checkbox" checked={enableLocalApi} onChange={event => setEnableLocalApi(event.target.checked)} />
        Enable the authenticated local API and CLI</label>}
      {feedback && <p role="alert">{feedback}</p>}
      <button disabled={working}>Continue</button>
    </form>
  </dialog>;
}
