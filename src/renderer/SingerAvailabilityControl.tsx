import React, { useEffect, useState } from 'react';
import type { Singer } from '../domain';
import { SINGER_ON_HOLD, timedSingerReturnAt } from '../domain/singer-availability';

/** Availability and removal are tucked into a keyboard-accessible context menu. */
export function SingerAvailabilityControl({ singer, nowMs, busy, onChange, onHold, onRemove, removeBlocked, points, credits }: {
  singer: Singer; nowMs: number; busy: boolean; onChange: (minutes: number) => void; onHold: () => void; onRemove: () => void;
  removeBlocked: boolean; points?: number; credits?: number;
}) {
  const [minutes, setMinutes] = useState(5);
  const [menu, setMenu] = useState<{x:number;y:number} | null>(null);
  const held = singer.unavailableUntilMs === SINGER_ON_HOLD;
  const remaining = Math.ceil(Math.max(0, timedSingerReturnAt(singer.unavailableUntilMs) - nowMs) / 60000);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest(`[data-singer-menu="${CSS.escape(singer.id)}"]`)) setMenu(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', dismiss); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('mousedown', dismiss); window.removeEventListener('keydown', escape); };
  }, [menu, singer.id]);
  const open = (x:number, y:number) => setMenu({x: Math.max(0, Math.min(x, window.innerWidth - 280)), y: Math.max(0, Math.min(y, window.innerHeight - 225))});
  return <div className="track-row" onContextMenu={event => {event.preventDefault(); open(event.clientX, event.clientY);}}>
    <div><strong>{singer.name}</strong><small>{held ? 'On hold' : remaining ? `Unavailable · back in ${remaining} min` : 'Available'}</small>
      {(points !== undefined || credits !== undefined) && <small>{points !== undefined && `${points} points`}{points !== undefined && credits !== undefined && ' · '}{credits !== undefined && `${credits} applause credits`}</small>}</div>
    <button type="button" aria-label={`Actions for ${singer.name}`} aria-haspopup="menu" aria-expanded={!!menu} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); open(rect.left, rect.bottom); }}>⋯</button>
    {menu && <div className="song-menu" role="menu" aria-label={`${singer.name} actions`} data-singer-menu={singer.id} style={{left:menu.x,top:menu.y,maxHeight:`calc(100vh - ${menu.y + 8}px)`}}>
      {!held && <>
        <label>Unavailable for <input type="number" aria-label={`${singer.name} unavailable minutes`} min="1" max="60" step="1" value={minutes}
          disabled={busy} onChange={event => setMinutes(Number(event.target.value))} style={{width:'5em'}} /> min</label>
        <button role="menuitem" disabled={busy || !Number.isInteger(minutes) || minutes < 1 || minutes > 60} onClick={() => { onChange(minutes); setMenu(null); }}>Mark unavailable</button>
        <button role="menuitem" disabled={busy} onClick={() => { onHold(); setMenu(null); }}>Hold until returned</button>
      </>}
      {(held || remaining > 0) && <button role="menuitem" disabled={busy} onClick={() => { onChange(0); setMenu(null); }}>Return now</button>}
      {removeBlocked && <small>Remove or reassign this singer’s queued songs first.</small>}
      <button role="menuitem" disabled={busy || removeBlocked} onClick={() => { setMenu(null); onRemove(); }}>Remove from show…</button>
    </div>}
  </div>;
}
