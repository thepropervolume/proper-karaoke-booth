// Inline the approved recordings so they work in both a file:// singer window
// and an offline mobile app without extra network or filesystem permissions.
import clip1 from '../../assets/audio/applause/clap-track-01-9097ms.mp3?inline';
import clip2 from '../../assets/audio/applause/clap-track-02-9025ms.mp3?inline';
import clip3 from '../../assets/audio/applause/clap-track-03-4033ms.mp3?inline';
import clip4 from '../../assets/audio/applause/clap-track-04-5330ms.mp3?inline';
import clip5 from '../../assets/audio/applause/clap-track-05-11185ms.mp3?inline';
import clip6 from '../../assets/audio/applause/clap-track-06-5065ms.mp3?inline';

export const applauseClips = [clip1, clip2, clip3, clip4, clip5, clip6] as const;
