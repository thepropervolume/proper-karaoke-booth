import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MobileSong } from './show';
import { loadLocalMedia } from './storage';
import { Capacitor } from '@capacitor/core';
import { MOBILE_ORIGIN } from './api';
type YoutubePlayer = { playVideo(): void; pauseVideo(): void; seekTo(seconds: number, ahead: boolean): void; setVolume(volume: number): void; getCurrentTime(): number; getDuration(): number; destroy(): void };
type YoutubeApi = { Player: new (node: HTMLElement, options: object) => YoutubePlayer };
let youtubeLoading: Promise<YoutubeApi> | null = null;
function youtubeApi(): Promise<YoutubeApi> {
  const w = window as unknown as { YT?: YoutubeApi; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  return youtubeLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'), timer = setTimeout(() => failed(), 15000);
    const failed = () => { clearTimeout(timer); youtubeLoading = null; script.remove(); reject(new Error('YouTube could not load. Check your connection.')); };
    w.onYouTubeIframeAPIReady = () => { clearTimeout(timer); w.YT?.Player ? resolve(w.YT) : failed(); };
    script.src = 'https://www.youtube.com/iframe_api'; script.onerror = failed; document.head.append(script);
  });
}
export type PlayerHandle = { seek(seconds: number): void; position(): number | null; fullscreen(): void };
export const MobilePlayer = forwardRef<PlayerHandle, { song: MobileSong | null; playing: boolean; volume: number; generation: string;
  startPosition: number;
  onEnded(): void; onBlocked(): void; onError(message: string): void; onTime(time: number, duration: number): void; onPlayback(playing: boolean): void }>(function MobilePlayer(props, ref) {
  const frame = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), container = useRef<HTMLDivElement>(null), youtube = useRef<YoutubePlayer | null>(null);
  const nativeFrame = useRef<HTMLIFrameElement>(null), nativeReady = useRef(false);
  const nativeChannel = React.useMemo(() => crypto.randomUUID(), [props.song?.id, props.generation]);
  // Capture a checkpoint only when the player is created. Subsequent saves must
  // not seek an already playing video again.
  const initialPosition = React.useMemo(() => Number.isFinite(props.startPosition) ? Math.max(0, Math.min(86400, props.startPosition)) : 0, [props.song?.id, props.generation]);
  const progress = React.useMemo(() => ({ ready: initialPosition === 0, started: false, last: null as number | null }), [props.song?.id, props.generation]);
  const native = Capacitor.isNativePlatform();
  const nativeCommand = (command: string, value?: number) => nativeFrame.current?.contentWindow?.postMessage({ type: 'tpv-player-command', channel: nativeChannel, command, value }, MOBILE_ORIGIN);
  const latest = useRef(props); latest.current = props;
  const [localUrl, setLocalUrl] = useState('');
  const reportTime = (time: number, duration: number) => {
    if (!Number.isFinite(time) || time < 0 || time > 86400) return;
    // An unstarted YouTube player reports zero even when its start parameter is
    // set. Do not replace the saved position with that provisional value.
    if (!progress.ready) {
      if (!progress.started || time < Math.max(.5, initialPosition - 15)) return;
      progress.ready = true;
    }
    progress.last = time; latest.current.onTime(time, duration);
  };
  useImperativeHandle(ref, () => ({ seek(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    if (video.current && Number.isFinite(video.current.duration)) video.current.currentTime = Math.min(seconds, video.current.duration);
    youtube.current?.seekTo(seconds, true);
    nativeCommand('seek', seconds);
    progress.ready = true; progress.last = seconds;
  }, position() {
    if (!progress.ready) return null;
    const value = video.current?.currentTime ?? (native ? progress.last : youtube.current?.getCurrentTime()) ?? progress.last;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400 ? value : null;
  }, fullscreen() {
    if (!container.current?.requestFullscreen) { latest.current.onError('Use the video’s fullscreen button or your device’s screen-mirroring controls.'); return; }
    void container.current.requestFullscreen().catch(() => latest.current.onError('Use the video’s fullscreen button or your device’s screen-mirroring controls.'));
  } }), [nativeChannel, progress]);
  useEffect(() => {
    if (!native || !props.song?.videoId) return;
    nativeReady.current = false;
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.origin !== MOBILE_ORIGIN || event.source !== nativeFrame.current?.contentWindow || !data || data.type !== 'tpv-player-event' || data.channel !== nativeChannel) return;
      if (data.event === 'ready') { nativeReady.current = true; nativeCommand('volume', latest.current.volume * 100); if (latest.current.playing) nativeCommand('play'); }
      else if (data.event === 'state') { if (data.value === 0) latest.current.onEnded(); else if (data.value === 1 || data.value === 2) { if (data.value === 1) progress.started = true; latest.current.onPlayback(data.value === 1); } }
      else if (data.event === 'blocked') latest.current.onBlocked();
      else if (data.event === 'error') latest.current.onError('This YouTube recording could not play. Check the connection, skip or choose another version.');
      else if (data.event === 'time' && Number.isFinite(data.value?.elapsed) && Number.isFinite(data.value?.duration) && data.value.elapsed >= 0 && data.value.duration >= 0) reportTime(data.value.elapsed, data.value.duration);
    };
    window.addEventListener('message', receive);
    return () => { nativeReady.current = false; window.removeEventListener('message', receive); };
  }, [native, props.song?.id, nativeChannel]);
  useEffect(() => {
    let active = true, url = ''; setLocalUrl('');
    if (props.song?.provider === 'local') void loadLocalMedia(props.song.id).then(blob => {
      if (!active) return;
      if (!blob) throw new Error('This local video is missing. Import it again on this device.');
      url = URL.createObjectURL(blob); setLocalUrl(url);
    }).catch(error => { if (active) latest.current.onError(error instanceof Error ? error.message : 'Local video unavailable.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [props.song?.id, props.generation]);
  useEffect(() => {
    const holder = frame.current;
    if (!holder || !props.song?.videoId) return;
    let active = true, player: YoutubePlayer | null = null;
    const node = document.createElement('div'); holder.replaceChildren(node);
    void youtubeApi().then(api => {
      if (!active) return;
      player = new api.Player(node, { width: '100%', height: '100%', videoId: props.song!.videoId,
        playerVars: { playsinline: 1, controls: 1, autoplay: 0, start: Math.floor(initialPosition), origin: location.origin, rel: 0 }, events: {
          onReady: () => { if (!active || !player) return; youtube.current = player; player.setVolume(latest.current.volume * 100); if (latest.current.playing) player.playVideo(); },
          onStateChange: (event: { data: number }) => { if (!active) return; if (event.data === 0) latest.current.onEnded(); else if (event.data === 1 || event.data === 2) { if (event.data === 1) progress.started = true; latest.current.onPlayback(event.data === 1); } },
          onAutoplayBlocked: () => { if (active) latest.current.onBlocked(); },
          onError: (event: { data: number }) => { if (active) latest.current.onError(event.data === 101 || event.data === 150 ? 'This creator disabled embedded playback. Skip or choose another recording.' : event.data === 153 ? 'YouTube could not verify this player. Open the web app in your browser.' : 'This YouTube recording is unavailable. Skip or choose another version.'); },
        } });
    }).catch(error => { if (active) latest.current.onError(error instanceof Error ? error.message : 'YouTube unavailable.'); });
    const timer = setInterval(() => { if (active && youtube.current) reportTime(youtube.current.getCurrentTime(), youtube.current.getDuration()); }, 500);
    return () => { active = false; clearInterval(timer); youtube.current = null; player?.destroy(); holder.replaceChildren(); };
  }, [props.song?.id, props.generation]);
  useEffect(() => {
    if (nativeReady.current) nativeCommand(props.playing ? 'play' : 'pause');
    if (props.playing) { youtube.current?.playVideo(); if (localUrl) void video.current?.play().catch(() => latest.current.onBlocked()); }
    else { youtube.current?.pauseVideo(); video.current?.pause(); }
  }, [props.playing, localUrl]);
  useEffect(() => { if (nativeReady.current) nativeCommand('volume', props.volume * 100); youtube.current?.setVolume(props.volume * 100); if (video.current) video.current.volume = props.volume; }, [props.volume, localUrl]);
  return <div className="mobile-player" ref={container}>
    {!props.song ? <div className="mobile-idle"><img src="./icon-192.png" alt="" /><strong>Ready When You Are</strong><span>Add a song, then press Play.</span></div> : props.song.provider === 'local' ?
      <video ref={video} src={localUrl || undefined} controls playsInline onLoadedMetadata={() => { const node = video.current; if (!node) return; if (initialPosition > 0 && Number.isFinite(node.duration)) node.currentTime = Math.min(initialPosition, Math.max(0, node.duration - .25)); progress.ready = true; reportTime(node.currentTime, node.duration); }} onEnded={props.onEnded} onPlay={() => props.onPlayback(true)} onPause={() => { if (!video.current?.ended) props.onPlayback(false); }} onError={() => props.onError('This video could not play. Check the file and its codec, or choose another recording.')}
        onTimeUpdate={() => { if (video.current) reportTime(video.current.currentTime, video.current.duration); }} /> : native ?
      <iframe key={nativeChannel} className="mobile-youtube" ref={nativeFrame} title="YouTube Karaoke Player" allow="autoplay; fullscreen; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => nativeCommand('hello')} src={`${MOBILE_ORIGIN}/app/youtube-player.html#${new URLSearchParams({ video: props.song.videoId!, channel: nativeChannel, start: String(Math.floor(initialPosition)) })}`} /> : <div className="mobile-youtube" ref={frame} />}
  </div>;
});
