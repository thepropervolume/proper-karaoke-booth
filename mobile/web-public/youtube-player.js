/* A fixed HTTPS document gives native WebViews a valid YouTube client origin.
   This bridge carries public player state only, never room/account credentials. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1)), video = params.get('video'), channel = params.get('channel');
  if (!/^[A-Za-z0-9_-]{11}$/.test(video || '') || !/^[a-f0-9-]{36}$/.test(channel || '')) return;
  const rawStart = params.get('start') || '0', start = /^\d{1,5}$/.test(rawStart) ? Number(rawStart) : 0;
  if (start > 86400) return;
  let player, ready = false, parentOrigin = null;
  const allowed = new Set(['capacitor://localhost', 'https://localhost', 'https://queue.thepropervolume.com', 'null']);
  const emit = (event, value) => {
    if (parentOrigin === null || parent === window) return;
    // Opaque WebView origins require '*'; the parent window and random channel
    // are pinned by the incoming handshake. There are no authentication data.
    parent.postMessage({ type: 'tpv-player-event', channel, event, value }, parentOrigin === 'null' ? '*' : parentOrigin);
  };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== parent || !allowed.has(event.origin) || !data || data.type !== 'tpv-player-command' || data.channel !== channel) return;
    if (data.command === 'hello') { parentOrigin = event.origin; if (ready) emit('ready'); return; }
    if (parentOrigin !== event.origin || !ready || !player) return;
    if (data.command === 'play') player.playVideo();
    else if (data.command === 'pause') player.pauseVideo();
    else if (data.command === 'seek' && Number.isFinite(data.value) && data.value >= 0 && data.value <= 86400) player.seekTo(data.value, true);
    else if (data.command === 'volume' && Number.isFinite(data.value) && data.value >= 0 && data.value <= 100) player.setVolume(data.value);
  });
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', { videoId: video, width: '100%', height: '100%', playerVars: { origin: location.origin, playsinline: 1, autoplay: 0, start, controls: 1, rel: 0 }, events: {
      onReady: () => { ready = true; emit('ready'); }, onAutoplayBlocked: () => emit('blocked'), onError: event => emit('error', event.data),
      onStateChange: event => emit('state', event.data),
    } });
  };
  const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.onerror = () => emit('error', 0); document.head.append(script);
  setInterval(() => { if (ready) emit('time', { elapsed: player.getCurrentTime(), duration: player.getDuration() }); }, 500);
})();
