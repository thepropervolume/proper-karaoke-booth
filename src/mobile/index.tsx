import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { MobileEntry } from './App';
createRoot(document.getElementById('root')!).render(<MobileEntry />);
if ('serviceWorker' in navigator && !Capacitor.isNativePlatform() && location.protocol === 'https:') {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {}); });
}
