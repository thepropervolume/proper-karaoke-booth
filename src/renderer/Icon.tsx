import React from 'react';

export type IconName = 'search' | 'display' | 'play' | 'pause' | 'stop' | 'skip' | 'settings' | 'file' | 'folder';

/** Decorative icons: the containing control supplies an accessible name. */
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    play: <path d="M8 4.5v15l12-7.5z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    skip: <><path d="M5 5v14l10-7zM19 5v14" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4" /><circle cx="12" cy="12" r="8" /></>,
    file: <><path d="M6 2h8l4 4v16H6zM14 2v5h4M12 11v7M8.5 14.5h7" /></>,
    folder: <><path d="M3 6h7l2 2h9v11H3zM12 10v7M8.5 13.5h7" /></>,
  };
  return <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
