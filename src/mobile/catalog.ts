import { validMobileSong, type MobileSong } from './show';
export function parseMobileCatalog(value: unknown): MobileSong[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { items?: unknown }).items)) throw new Error('The catalog response was invalid.');
  const items = (value as { items: unknown[] }).items;
  if (items.length > 50 || !items.every(validMobileSong)) throw new Error('The catalog response was invalid.');
  return items as MobileSong[];
}
export function youtubeLink(value: string): MobileSong | null {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const id = u.hostname === 'youtu.be' ? u.pathname.slice(1) : ['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname) && u.pathname === '/watch' ? u.searchParams.get('v') : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? { id: `youtube_${id}`, provider: 'youtube', videoId: id, title: 'YouTube Karaoke', artist: '' } : null;
  } catch { return null; }
}
