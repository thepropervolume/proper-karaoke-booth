/** Map only known renderer codes; never display a renderer-provided error or filesystem path. */
export function mediaErrorDetail(code: unknown): string {
  switch (code) {
    case 'decode': return 'The KaraFun audio could not be decoded. Stop the song, retry preparation in Sources, and press Play when ready.';
    case 'requires-premix': return 'This KaraFun recording exceeds the native audio preparation limit. Stop and choose another recording; a fixed audio mix is not available yet.';
    case 'MEDIA_ERR_ABORTED': return 'Playback was interrupted. Check the song file and resume when ready.';
    case 'MEDIA_ERR_NETWORK': return 'The song could not be read. Restore access to the drive or network location and press Play. To relink a moved file, Stop to return the request to the queue, then choose Relink File in Song Library.';
    case 'MEDIA_ERR_DECODE': return 'The video could not be decoded. Press Play to retry. If it still fails, Stop to return the request to the queue and edit it to use an imported copy with a supported codec, such as H.264 video and AAC audio in MP4.';
    case 'MEDIA_ERR_SRC_NOT_SUPPORTED': return 'This file or its codec could not be played. Stop to return the request to the queue, then edit it to use an imported copy with a supported codec, such as H.264 video and AAC audio in MP4.';
    case 'PLAY_BLOCKED': return 'Playback was blocked. Check the singer display and try resuming.';
    default: return 'Playback failed. Check the song file, relink the original if it moved, and verify its codec.';
  }
}

/** Native I/O errors can contain private paths. Use only known error codes. */
export function mediaVerificationDetail(error: unknown, resuming: boolean): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const relink = resuming ? 'Restore access and press Play, or Stop to return the request to the queue and relink its original file.' :
    'Right-click the song in Song Library and choose Relink File.';
  if (code === 'ENOENT' || code === 'ENOTDIR') return `The source file is unavailable. ${relink}`;
  if (code === 'EACCES' || code === 'EPERM') return 'Booth could not read the source file because access was denied. Check its permissions, then press Play to retry.';
  if (code === 'ERR_MEDIA_CHANGED_DURING_READ' || code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'EIO' || code === 'EBUSY' || code === 'EAGAIN')
    return 'Booth could not finish reading the song. Check the drive connection and let any download or file sync finish, then press Play to retry.';
  return 'The song file could not be verified. Check that the source is a readable original MP4, then press Play to retry.';
}
