/** Map only known renderer codes; never display a renderer-provided error or filesystem path. */
export function mediaErrorDetail(code: unknown): string {
  switch (code) {
    case 'decode': return 'The KaraFun audio could not be decoded. Stop the song, retry preparation in Sources, and press Play when ready.';
    case 'requires-premix': return 'This KaraFun recording exceeds the native audio preparation limit. Stop and choose another recording; a fixed audio mix is not available yet.';
    case 'MEDIA_ERR_ABORTED': return 'Playback was interrupted. Check the song file and resume when ready.';
    case 'MEDIA_ERR_NETWORK': return 'The song could not be read. Check the drive or network location, or relink the original file.';
    case 'MEDIA_ERR_DECODE': return 'The video could not be decoded. Check the file or try a supported MP4 codec.';
    case 'MEDIA_ERR_SRC_NOT_SUPPORTED': return 'This video or codec is not supported. Check the file and try a supported MP4 codec.';
    case 'PLAY_BLOCKED': return 'Playback was blocked. Check the singer display and try resuming.';
    default: return 'Playback failed. Check the song file, relink the original if it moved, and verify its codec.';
  }
}
