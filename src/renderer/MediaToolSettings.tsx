import React, { useEffect, useState } from 'react';
import { isYtDlpChannel, type MediaToolStatus, type YtDlpChannel } from '../domain/media-tools';

export function MediaToolSettings({ channel, customExecutable, changeChannel }: {
  channel: YtDlpChannel; customExecutable: string; changeChannel: (channel: YtDlpChannel) => void;
}) {
  const [status, setStatus] = useState<MediaToolStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setStatus(null);
    void window.tpv.mediaToolStatus(channel).then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setMessage('Could not check media tools.'); });
    return () => { active = false; };
  }, [channel, revision]);

  async function prepare(tool: 'downloader' | 'ffmpeg') {
    setBusy(true);
    setMessage(tool === 'downloader' ? 'Downloading and verifying yt-dlp…' : 'Installing FFmpeg…');
    try {
      const result = await (tool === 'downloader' ? window.tpv.prepareMediaDownloader(channel) : window.tpv.installFfmpeg());
      setMessage(result.ok ? (tool === 'downloader' ? 'yt-dlp is ready.' : 'FFmpeg and FFprobe are ready.') : result.error ?? 'Setup failed.');
    } catch { setMessage('Setup failed. Check the connection and try again.'); }
    finally { setBusy(false); setRevision(count => count + 1); }
  }

  return <>
    <label>yt-dlp release<select value={channel} disabled={busy || !!customExecutable}
      onChange={event => { if (isYtDlpChannel(event.target.value)) { changeChannel(event.target.value); setMessage(''); } }}>
      <option value="stable">Stable</option><option value="nightly">Nightly</option>
    </select></label>
    {status?.ytDlpVersion && !customExecutable && <div className="settings-inline-help">
      <span>{status.ytDlpVersion} {status.ytDlpReady ? 'ready' : 'downloads on first use'}</span>
      {!status.ytDlpReady && <button type="button" disabled={busy} onClick={() => void prepare('downloader')}>Prepare yt-dlp</button>}
    </div>}
    {status && <div className="settings-inline-help">
      <span>FFmpeg {status.ffmpeg ? 'found' : 'missing'} · FFprobe {status.ffprobe ? 'found' : 'missing'}</span>
      {status.installWith && <button type="button" disabled={busy} onClick={() => void prepare('ffmpeg')}>Install with {status.installWith}</button>}
      {!status.installWith && (!status.ffmpeg || !status.ffprobe) && <span>Install FFmpeg using your system package manager.</span>}
      <button type="button" disabled={busy} onClick={() => setRevision(count => count + 1)}>Check Again</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </>;
}
