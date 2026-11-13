import React, { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Instant, keyboard-accessible help. Include shortcut hints in text when applicable. */
export function Tooltip({ text, children }: {
  text: string;
  children: React.ReactElement<{ 'aria-describedby'?: string; disabled?: boolean }>;
}) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, ready: false });
  const open = (hovered || focused) && !dismissed;
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = bubble.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + anchor.width / 2 - box.width / 2));
      const top = anchor.bottom + 8 + box.height <= window.innerHeight - 8 ? anchor.bottom + 8 : Math.max(8, anchor.top - box.height - 8);
      setPosition({ left, top, ready: true });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open, text]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setDismissed(true); };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [open]);
  const describedBy = [children.props['aria-describedby'], id].filter(Boolean).join(' ');
  const target = trigger.current?.closest('dialog') ?? document.body;
  return <>
    <span ref={trigger} className="tooltip-trigger"
      onMouseEnter={() => { setDismissed(false); setHovered(true); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setDismissed(false); setFocused(true); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      {cloneElement(children, { 'aria-describedby': describedBy })}
    </span>
    {open && createPortal(<span ref={bubble} id={id} role="tooltip" className="tooltip-bubble"
      style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}>{text}</span>, target)}
  </>;
}
