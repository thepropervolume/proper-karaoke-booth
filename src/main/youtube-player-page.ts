/** Values in this file are app-owned; the browser never receives show data. */
export const YOUTUBE_APP_ID = 'com.thepropervolume.karaoke';
export const YOUTUBE_REFERER = `https://${YOUTUBE_APP_ID}/`;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function youtubeEmbedUrl(input: unknown): string {
  if (typeof input !== 'string' || !VIDEO_ID.test(input)) throw new Error('Invalid YouTube video.');
  return `https://www.youtube.com/embed/${input}?controls=1&playsinline=1`;
}

/** No scripts, overlays, local state, automatic playback, or arbitrary markup. */
export function youtubePlayerPage(input: unknown): string {
  const url = youtubeEmbedUrl(input);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube Player</title><style>
html,body{height:100%;margin:0;background:#101724;color:#f4f2e9;font:14px system-ui,sans-serif}body{display:flex;flex-direction:column}header{padding:10px 14px;flex:none}iframe{width:100%;flex:1;min-height:200px;border:0}
</style></head><body><header>YouTube player · Plays separately from the show queue using your system audio output. Closing or leaving this window stops playback.</header><iframe title="YouTube video player" src="${url}" allow="encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" allowfullscreen></iframe></body></html>`;
}

/** Only explicit HTTPS YouTube links may be opened in the system browser. */
export function allowedYouTubeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname);
  } catch { return false; }
}
