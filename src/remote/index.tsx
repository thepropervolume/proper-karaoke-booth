import React from 'react';
import { createRoot } from 'react-dom/client';
import { createSingerClient, SingerPage } from './SingerPage';

const client = createSingerClient(window.location, window.history);
createRoot(document.getElementById('root')!).render(<SingerPage client={client} />);
