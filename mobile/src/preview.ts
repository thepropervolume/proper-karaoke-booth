/** Synthetic data only. This module cannot connect to a show or persist credentials. */
export type PreviewSong = { id: string; title: string; artist: string };
export type PreviewRequest = { id: string; versionId: string; status: 'accepted' | 'withdrawn' };
export type PreviewState = { songs: PreviewSong[]; requests: PreviewRequest[]; nextId: number };

export function initialPreview(): PreviewState {
  return { songs: [
    { id: 'demo-1', title: 'Example Song', artist: 'Sample Artist' },
    { id: 'demo-2', title: 'Another Example', artist: 'Demo Band' },
    { id: 'demo-3', title: 'A Song for Tonight', artist: 'Sample Artist' },
  ], requests: [], nextId: 1 };
}

export function searchPreview(state: PreviewState, query: string): PreviewSong[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return state.songs.filter(song => terms.every(term => `${song.title} ${song.artist}`.toLocaleLowerCase().includes(term)));
}

export function addPreviewRequest(state: PreviewState, versionId: string): PreviewState {
  if (!state.songs.some(song => song.id === versionId)) return state;
  return { ...state, requests: [...state.requests, { id: `demo-request-${state.nextId}`, versionId, status: 'accepted' }], nextId: state.nextId + 1 };
}

export function withdrawPreviewRequest(state: PreviewState, requestId: string): PreviewState {
  return { ...state, requests: state.requests.map(request => request.id === requestId && request.status === 'accepted' ? { ...request, status: 'withdrawn' } : request) };
}
