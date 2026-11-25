import React, { useRef } from 'react';
import { IonButton, IonContent, IonIcon, IonModal } from '@ionic/react';
import { closeOutline } from 'ionicons/icons';

const detents = [0, 0.82, 1];

export function SingerSheet({ title, dismiss, busy, children }: {
  title: string;
  dismiss: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLIonModalElement>(null);
  return <IonModal ref={ref} isOpen className="singer-sheet" aria-label={title}
    breakpoints={detents} initialBreakpoint={0.82} handle canDismiss={!busy} onDidDismiss={dismiss}>
    <IonContent className="singer-sheet-scroll">
      <div className="singer-sheet-body">
        <header className="singer-sheet-heading">
          <h2>{title}</h2>
          <IonButton type="button" className="singer-ion-icon" fill="clear" shape="round"
            disabled={busy} aria-label="Close" onClick={() => void ref.current?.dismiss()}>
            <IonIcon icon={closeOutline} aria-hidden="true" />
          </IonButton>
        </header>
        {children}
      </div>
    </IonContent>
  </IonModal>;
}
