import React, { useEffect, useState } from 'react';

export function AudioOutputPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio output enumeration is unavailable.');
        const list = await navigator.mediaDevices.enumerateDevices();
        if (alive) { setDevices(list.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default')); setError(''); }
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); }
    };
    void refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => { alive = false; navigator.mediaDevices?.removeEventListener('devicechange', refresh); };
  }, []);
  const missing = value && !devices.some(device => device.deviceId === value);
  return <>
    <label>Output Device<select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">System default</option>
      {missing && <option value={value}>Previously selected output unavailable</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Audio output ${index + 1}`}</option>)}
    </select></label>
    <p className="muted">Changing output pauses an active song. If audio devices change, playback pauses until you deliberately resume. System default follows your operating system.</p>
    {error && <p role="status">Could not list outputs: {error}</p>}
  </>;
}
