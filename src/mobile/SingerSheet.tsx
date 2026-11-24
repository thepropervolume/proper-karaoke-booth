import React, { useEffect, useId, useRef } from 'react';
import { IonIcon } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

export function SingerSheet({ title, dismiss, busy, children }: {
  title: string;
  dismiss: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className="singer-sheet" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="singer-sheet-body">
      <header className="singer-sheet-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="singer-icon-button singer-icon-quiet" disabled={busy} aria-label="Close" onClick={dismiss}>
          <IonIcon icon={closeOutline} aria-hidden="true" />
        </button>
      </header>
      {children}
    </div>
  </dialog>;
}
