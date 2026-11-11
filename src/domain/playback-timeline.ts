export type PlaybackTimelineState = { generation: string | null; position: number; duration: number; seekable: boolean; seeking: boolean };
export type PlaybackSeek = { generation: string; position: number };
export type PlaybackSeekResult = { ok: true } | { ok: false; error: string };

export function formatPlaybackTime(seconds: number): string {
  const whole = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  const hours = Math.floor(whole / 3600), minutes = Math.floor(whole / 60) % 60, rest = whole % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}
