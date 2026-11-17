import React, { useEffect, useRef, useState } from 'react';
import type { MobileSong } from './show';
/** Keyboard users stay in the dialog; closing restores the button that opened it. */
export function QueueDialog({ song, onClose, onSubmit }: { song: MobileSong; onClose(): void; onSubmit(name: string): void }) {
  const form = useRef<HTMLFormElement>(null), [name, setName] = useState('');
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = form.current;
    target?.querySelector('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(target?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="mobile-dialog-backdrop"><form ref={form} className="mobile-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-dialog-title" onSubmit={event => { event.preventDefault(); onSubmit(name); }}><h2 id="queue-dialog-title">Add to Queue</h2><strong>{song.title}</strong><p>{song.artist}</p><label>Singer (optional)<input maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label><div><button type="button" onClick={onClose}>Cancel</button><button className="mobile-primary">Add Song</button></div></form></div>;
}
