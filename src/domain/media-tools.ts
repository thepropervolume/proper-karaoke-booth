export const YT_DLP_CHANNELS = ['stable', 'nightly'] as const;
export type YtDlpChannel = typeof YT_DLP_CHANNELS[number];

export function isYtDlpChannel(value: unknown): value is YtDlpChannel {
  return value === 'stable' || value === 'nightly';
}

export type MediaToolStatus = {
  ytDlpVersion: string | null;
  ytDlpReady: boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
  installWith: 'WinGet' | 'Homebrew' | null;
};
