import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { setupIonicReact } from '@ionic/react';
import '@ionic/react/css/core.css';
import { SingerWorkspace } from './SingerWorkspace';

setupIonicReact({ animated: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
createRoot(document.getElementById('root')!).render(<SingerWorkspace />);
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && location.protocol === 'https:') {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {}); });
}
