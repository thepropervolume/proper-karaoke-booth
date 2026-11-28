export const DESKTOP_UPDATE_MODES = ['notify', 'install', 'download', 'off'] as const;
export type DesktopUpdateMode = typeof DESKTOP_UPDATE_MODES[number];

export const DESKTOP_UPDATE_LABELS: Record<DesktopUpdateMode, string> = {
  notify: 'Notify me on startup',
  install: 'Download and Install',
  download: 'Download Only',
  off: 'Do Nothing',
};

export function isDesktopUpdateMode(value: unknown): value is DesktopUpdateMode {
  return DESKTOP_UPDATE_MODES.some(mode => mode === value);
}

export type DesktopUpdateStatus = {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloaded' | 'unavailable' | 'error';
  version?: string;
  message?: string;
  installable?: boolean;
};
