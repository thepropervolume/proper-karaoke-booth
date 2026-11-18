import React, { useState } from 'react';
import type { Singer } from '../domain';

export function SingerAvailabilityControl({ singer, nowMs, busy, onChange, points, credits }: {
  singer: Singer; nowMs: number; busy: boolean; onChange: (minutes: number) => void; points?: number; credits?: number;
}) {
  const [minutes, setMinutes] = useState(5);
  const remaining = Math.ceil(Math.max(0, (singer.unavailableUntilMs ?? 0) - nowMs) / 60000);
  return <div className="track-row"><div><strong>{singer.name}</strong><small>{remaining ? `Unavailable · back in ${remaining} min` : 'Available'}</small>
    {(points !== undefined || credits !== undefined) && <small>{points !== undefined && `${points} points`}{points !== undefined && credits !== undefined && ' · '}{credits !== undefined && `${credits} applause credits`}</small>}</div>
    <div><label>Unavailable for <input type="number" aria-label={`${singer.name} unavailable minutes`} min="1" max="60" step="1" value={minutes}
      disabled={busy} onChange={event => setMinutes(Number(event.target.value))} style={{ width: '5em' }} /> min</label>{' '}
      <button disabled={busy || !Number.isInteger(minutes) || minutes < 1 || minutes > 60} onClick={() => onChange(minutes)}>Mark unavailable</button>{' '}
      {remaining > 0 && <button disabled={busy} onClick={() => onChange(0)}>Return now</button>}
    </div>
  </div>;
}
