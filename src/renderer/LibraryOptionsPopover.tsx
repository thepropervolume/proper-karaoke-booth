import React, { useEffect, useId, useImperativeHandle, useRef } from 'react';
import { Tooltip } from './Tooltip';

export function LibraryOptionsPopover({ label, tooltip, children, trigger, triggerRef, className }: {
  label: string; tooltip: string; children: React.ReactNode; trigger: React.ReactNode;
  triggerRef?: React.Ref<HTMLButtonElement>; className?: string;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useImperativeHandle(triggerRef, () => button.current!, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      const panel = popup.current;
      if (event.key !== 'Escape' || !panel?.matches(':popover-open')) return;
      event.preventDefault();
      panel.hidePopover();
      button.current?.focus();
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  return <>
    <Tooltip text={tooltip}><button ref={button} type="button" className={className} aria-label={label} popoverTarget={id}
      onClick={event => {
        const box = event.currentTarget.getBoundingClientRect();
        const panel = popup.current;
        if (!panel) return;
        // The sticky results header lives inside a scrolling pane. A native
        // popover escapes clipping and still supports light-dismiss and Escape.
        const right = Math.min(Math.max(8, window.innerWidth - box.right), Math.max(8, window.innerWidth - 222));
        const below = window.innerHeight - box.bottom;
        const above = below < 265 && box.top > below;
        panel.style.right = `${right}px`;
        panel.style.top = above ? 'auto' : `${box.bottom + 4}px`;
        panel.style.bottom = above ? `${window.innerHeight - box.top + 4}px` : 'auto';
        panel.style.maxHeight = `${Math.max(70, (above ? box.top : below) - 12)}px`;
      }}>{trigger}</button></Tooltip>
    <div id={id} ref={popup} popover="auto" className="library-options-popover" aria-label={label} role="group">{children}</div>
  </>;
}
