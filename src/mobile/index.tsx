import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { IonApp, setupIonicReact } from '@ionic/react';
import '@ionic/react/css/core.css';
import { MobileApp } from './MobileApp';

setupIonicReact({ animated: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
createRoot(document.getElementById('root')!).render(<IonApp><MobileApp /></IonApp>);
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && location.protocol === 'https:') {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {}); });
}
