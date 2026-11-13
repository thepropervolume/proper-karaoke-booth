export type MediaFailure = 'MEDIA_ERR_ABORTED' | 'MEDIA_ERR_NETWORK' | 'MEDIA_ERR_DECODE' | 'MEDIA_ERR_SRC_NOT_SUPPORTED' | 'PLAY_FAILED' | 'PLAY_BLOCKED';

/** HTML media error codes are standardized; never send decoder messages or paths to the host. */
export function mediaFailure(code: number | undefined): MediaFailure {
  switch (code) {
    case 1: return 'MEDIA_ERR_ABORTED';
    case 2: return 'MEDIA_ERR_NETWORK';
    case 3: return 'MEDIA_ERR_DECODE';
    case 4: return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
    default: return 'PLAY_FAILED';
  }
}

export function playFailure(reason: unknown): MediaFailure {
  if (reason && typeof reason === 'object' && 'name' in reason) {
    if (reason.name === 'NotAllowedError') return 'PLAY_BLOCKED';
    if (reason.name === 'NotSupportedError') return 'MEDIA_ERR_SRC_NOT_SUPPORTED';
  }
  return 'PLAY_FAILED';
}
