import React from 'react';

export type IconName = 'search' | 'display' | 'fullscreen' | 'play' | 'pause' | 'stop' | 'skip' | 'previous' | 'cdg' | 'settings' | 'file' | 'folder' | 'palette' | 'library' | 'playlist' | 'globe' | 'inbox' | 'singers' | 'remote' | 'close' | 'check' | 'warning' | 'info' | 'applause';

/** Decorative icons: the containing control supplies an accessible name. */
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
    play: <path d="M8 4.5v15l12-7.5z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    skip: <><path d="M5 5v14l10-7zM19 5v14" /></>,
    previous: <><path d="M19 5v14L9 12zM5 5v14" /></>,
    cdg: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M12 3v4M8 5l2 3M17 17h4M19 15v4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /><circle cx="12" cy="12" r="8" /></>,
    palette: <><path d="M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a2 2 0 0 1 0-4h4a4 4 0 0 0 3.5-6.1A9 9 0 0 0 12 3z" /><circle cx="7.5" cy="11" r=".7" /><circle cx="10" cy="7" r=".7" /><circle cx="15" cy="7" r=".7" /></>,
    file: <><path d="M6 2h8l4 4v16H6zM14 2v5h4M12 11v7M8.5 14.5h7" /></>,
    folder: <><path d="M3 6h7l2 2h9v11H3zM12 10v7M8.5 13.5h7" /></>,
    library: <><path d="M9 17V5l10-2v12" /><circle cx="6" cy="17.5" r="3" /><circle cx="16" cy="15.5" r="3" /></>,
    playlist: <><path d="M4 6h12M4 12h12M4 18h8" /><path d="M17.5 14v6l5-3z" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
    inbox: <><path d="M4 4h16v12H4zM4 12h5l2 3h2l2-3h5" /><path d="M12 16v5M8 19l4 2 4-2" /></>,
    singers: <><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    applause: <><path d="M8 13 5.2 9.7a1.1 1.1 0 0 1 1.7-1.4l3.2 3.5-2.7-5a1 1 0 0 1 1.8-1l2.9 4.8-1.3-5.1a1 1 0 0 1 2-.5l1.4 5 0-3.9a1 1 0 0 1 2 0v7.7l1.5-1.4a1.1 1.1 0 0 1 1.6 1.5l-3.3 4.3c-.8 1-2 1.6-3.3 1.6h-1.1c-1.6 0-3.1-.8-3.9-2.2L5 14.3a1 1 0 0 1 1.7-1.1L8 14.7" /><path d="m4 4-1-1M4 7H2M19 4l1-1M20 7h2" /></>,
    remote: <><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m4.5 12.5 5 5 10-11" />,
    warning: <><path d="M12 3 2.5 20h19z" /><path d="M12 9v5M12 17.2v.1" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.2v.1" /></>,
  };
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
