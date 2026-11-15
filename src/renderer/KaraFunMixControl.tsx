import React, { useEffect, useId, useRef, useState } from 'react';
import { KARAFUN_ROLE_LABELS, KARAFUN_STEM_ROLES, type KaraFunMixBridge, type KaraFunMixCommand, type KaraFunMixStatus } from '../domain/karafun-mix';
import { Tooltip } from './Tooltip';
import '../styles/karafun-mix.scss';

export function KaraFunMixControl({ bridge, generation }: { bridge: KaraFunMixBridge; generation: string | null }) {
  const [status, setStatus] = useState<KaraFunMixStatus | null>(null), [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true, published = false;
    const unsubscribe = bridge.subscribe(value => { published = true; if (alive) setStatus(value); });
    void bridge.status().then(value => { if (alive && !published) setStatus(value); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [bridge]);
  const current = status?.generation === generation ? status : null;
  useEffect(() => { setOpen(false); }, [generation, current?.generation]);
  return <>
    <Tooltip text={current ? 'Adjust this recording’s available vocal and instrumental channels' : 'Vocal Mix is available during native KaraFun playback'}>
      <button type="button" disabled={!current} onClick={() => setOpen(true)}>Vocal Mix</button>
    </Tooltip>
    {open && current && <KaraFunMixDialog key={current.generation} status={current} bridge={bridge} onClose={() => setOpen(false)} />}
  </>;
}

export function KaraFunMixDialog({ status, bridge, onClose }: { status: KaraFunMixStatus; bridge: KaraFunMixBridge; onClose(): void }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0), pending = useRef(false);
  const [draft, setDraft] = useState(status), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => { ++sequence.current; dialog.current?.close(); }; }, []);
  useEffect(() => { if (!pending.current) setDraft(status); }, [status]);
  const update = async (command: KaraFunMixCommand) => {
    const intent = ++sequence.current; pending.current = true; setError('');
    if ('stemId' in command) setDraft(current => ({ ...current, stems: current.stems.map(stem => stem.id === command.stemId ? { ...stem, volume: command.volume } : stem) }));
    try {
      const confirmed = await bridge.set(command);
      // Replies from an older drag position must not move the slider backwards.
      if (sequence.current === intent) setDraft(confirmed);
    } catch (reason) {
      if (sequence.current === intent) { setDraft(status); setError(reason instanceof Error ? reason.message : 'Could not adjust this channel. Reopen Vocal Mix.'); }
    } finally { if (sequence.current === intent) pending.current = false; }
  };
  return <dialog ref={dialog} className="settings-dialog karafun-mix-dialog" aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="settings-dialog__header"><h2 id={`${id}-title`}>Vocal Mix</h2><button type="button" aria-label="Close Vocal Mix" onClick={onClose}>✕</button></div>
    <p className="muted">This song only. Lead vocals start muted.</p>
    <div className="karafun-mix-dialog__channels">{KARAFUN_STEM_ROLES.filter(role => draft.stems.some(stem => stem.role === role)).map(role => <fieldset key={role}>
      <legend>{KARAFUN_ROLE_LABELS[role]}</legend>
      {draft.stems.filter(stem => stem.role === role).map(stem => <label className="karafun-mix-channel" key={stem.id}>
        <span>{stem.label}</span><input type="range" min="0" max="100" step="1" value={Math.round(stem.volume * 100)}
          aria-label={`${stem.label} Volume`} aria-valuetext={`${Math.round(stem.volume * 100)}%`}
          onChange={event => void update({ generation: draft.generation, stemId: stem.id, volume: Number(event.target.value) / 100 })} />
        <output>{Math.round(stem.volume * 100)}%</output>
      </label>)}
    </fieldset>)}</div>
    {error && <p role="alert">{error}</p>}
    <div className="settings-actions"><button type="button" onClick={() => void update({ generation: draft.generation, reset: true })}>Reset This Song</button><button type="button" className="primary" onClick={onClose}>Done</button></div>
  </dialog>;
}
