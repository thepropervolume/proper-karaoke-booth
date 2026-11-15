import type { LibrarySearchVersion } from '../domain/unified-library';

/** An online search result must acquire a durable library ID before downloading. */
export async function downloadLibrarySong(version: LibrarySearchVersion, bridge: {
  addYouTube(input: { url: string; title: string; artist: string; brandSlug?: string }): Promise<{ ok: boolean; versionId?: string; error?: string }>;
  youtubeDownloads: { start(id: string): Promise<unknown> };
}): Promise<{ ok: boolean; versionId?: string; error?: string }> {
  if (version.source?.provider !== 'youtube') return { ok: false, error: 'Choose a YouTube recording for this download action.' };
  let id = version.id;
  if (version.catalogTrack) {
    const added = await bridge.addYouTube({ url: `https://www.youtube.com/watch?v=${version.source.videoId}`,
      title: version.title, artist: version.artist, ...(version.catalogTrack.brandSlug ? { brandSlug: version.catalogTrack.brandSlug } : {}) });
    if (!added.ok || !added.versionId) return { ok: false, error: added.error || 'Could not save the selected recording to your library.' };
    id = added.versionId;
  }
  await bridge.youtubeDownloads.start(id);
  return { ok: true, versionId: id };
}
