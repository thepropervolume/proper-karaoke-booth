import React, { useRef } from 'react';

export function PanelSeparator({ label, orientation, value, minimum, maximum, reverse = false, defaultValue, onChange, onCommit, className = '' }: {
  label: string; orientation: 'vertical' | 'horizontal'; value: number; minimum: number; maximum: number; reverse?: boolean; defaultValue: number;
  onChange(value: number): void; onCommit(value: number): void; className?: string;
}) {
  const drag = useRef<{ id: number; origin: number; value: number; current: number } | null>(null);
  const clamp = (next: number) => Math.round(Math.max(minimum, Math.min(maximum, next)));
  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    const next = drag.current.current; drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onCommit(next);
  };
  return <div role="separator" aria-label={label} aria-orientation={orientation} aria-valuenow={Math.round(value)} aria-valuemin={minimum} aria-valuemax={maximum}
    tabIndex={0} className={`panel-separator panel-separator--${orientation} ${className}`}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, origin: orientation === 'vertical' ? event.clientX : event.clientY, value, current: value }; }}
    onPointerMove={event => { const start = drag.current; if (!start || start.id !== event.pointerId) return; const delta = (orientation === 'vertical' ? event.clientX : event.clientY) - start.origin; start.current = clamp(start.value + delta * (reverse ? -1 : 1)); onChange(start.current); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) { const next = drag.current.current; drag.current = null; onCommit(next); } }}
    onDoubleClick={() => { const next = clamp(defaultValue); onChange(next); onCommit(next); }}
    onKeyDown={event => { const positive = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown', negative = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
      if (![positive, negative, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); const next = clamp(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : value + (event.key === positive ? 1 : -1) * (reverse ? -1 : 1) * (event.shiftKey ? 32 : 8)); onChange(next); onCommit(next);
    }}><span aria-hidden="true" /></div>;
}
