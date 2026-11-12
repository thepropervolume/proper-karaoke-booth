import React from 'react';
import { createRoot } from 'react-dom/client';
import { createSingerClient, SingerPage } from './SingerPage';
import { InternetSingerEntry } from './InternetSingerEntry';
import { INTERNET_QUEUE_ORIGIN, validateSessionSlug } from './internet-session-control';

const slug = /^\/([a-z0-9-]+)\/?$/.exec(window.location.pathname)?.[1];
const internet = window.location.origin === INTERNET_QUEUE_ORIGIN && !!slug && !validateSessionSlug(slug);
createRoot(document.getElementById('root')!).render(internet
  ? <InternetSingerEntry slug={slug!} />
  : <SingerPage client={createSingerClient(window.location, window.history)} />);
