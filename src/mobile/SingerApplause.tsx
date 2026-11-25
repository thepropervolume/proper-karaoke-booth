import { useEffect, useRef, useState } from 'react';
import type { GuestApplause } from '../domain/guest-stage';
import { GUEST_APPLAUSE_WINDOW_MS } from '../domain/guest-stage';
import './singer-extras.css';

export function useSingerApplause(pulse: GuestApplause | undefined, serverNow: number | undefined) {
  const seen = useRef('');
  const [visible, setVisible] = useState('');
  const id = pulse?.id;
  const atMs = pulse?.atMs;
  useEffect(() => {
    if (!id || !atMs || seen.current === id) return;
    const age = (serverNow ?? Date.now()) - atMs;
    if (age < 0 || age >= GUEST_APPLAUSE_WINDOW_MS) return;
    seen.current = id;
    setVisible(id);
  }, [id, atMs, serverNow]);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(''), 2600);
    return () => clearTimeout(timer);
  }, [visible]);
  return visible;
}

export function SingerApplause({ animationId }: { animationId: string }) {
  return animationId ? <div className="singer-applause" key={animationId} aria-hidden="true">
    <span>👏</span><span>👏</span><span>👏</span>
  </div> : null;
}
