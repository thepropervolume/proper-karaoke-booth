import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';

export type SingerPreviewFrame = { image: string; width: number; height: number } | null;
export type SingerScreenUiStatus = { status: 'running' | 'stopped' | 'error'; port: number | null; urls: string[]; viewers: number; maximumViewers: number; message?: string };
export type SingerScreenBridge = { preview(): Promise<SingerPreviewFrame>; onPreview(callback: (frame: SingerPreviewFrame) => void): () => void; status(): Promise<SingerScreenUiStatus>; retry(): Promise<SingerScreenUiStatus>; copyUrl(url: string): Promise<void> };

/** Displays the actual singer window; never creates another player or audio sink. */
export function SingerPreview({ bridge, onOpen }: { bridge: SingerScreenBridge; onOpen(): void }) {
  const [frame, setFrame] = useState<SingerPreviewFrame>(null);
  useEffect(() => { let alive = true, received = false; const off = bridge.onPreview(value => { received = true; if (alive) setFrame(value); });
    void bridge.preview().then(value => { if (alive && !received) setFrame(value); }).catch(() => {});
    return () => { alive = false; off(); };
  }, [bridge]);
  return <section className="singer-preview" aria-label="Singer preview">
    <div className="singer-preview__heading"><span className="eyebrow">Singer Preview</span><button type="button" className="icon-button" aria-label="Open singer display from preview" onClick={onOpen}><Icon name="display" /></button></div>
    <div className="singer-preview__image">{frame ? <img src={frame.image} alt="Live singer display preview" /> : <p>Open the singer display to preview it here.</p>}</div>
    <small className="muted">Mirrors the singer screen · audio plays once</small>
  </section>;
}
