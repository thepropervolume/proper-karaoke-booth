import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseLrc } from '../domain/lrc';
import { exportLrcWebVtt } from '../domain/lrc-vtt';
import { runFfmpegConversion } from './ffmpeg-conversion';
import { findFfmpegTool } from './media-tool-paths';

// Force local container types rather than letting FFmpeg infer playlists or URLs.
const audioFormats = new Map([
  ['.mp3', 'mp3'], ['.wav', 'wav'], ['.flac', 'flac'], ['.m4a', 'mov'],
  ['.aac', 'aac'], ['.ogg', 'ogg'], ['.opus', 'ogg'],
]);
export const LYRIC_FILE_EXTENSIONS = ['cdg', 'lrc', 'zip', ...[...audioFormats.keys()].map(extension => extension.slice(1))];
export const LRC_BYTE_LIMIT = 1024 * 1024;
const AUDIO_DURATION_LIMIT = 2 * 60 * 60;
const probe = promisify(execFile);

function matchingSiblings(selected: string, names: string[]): string[] {
  const stem = basename(selected, extname(selected)).toLowerCase();
  return names.filter(name => basename(name, extname(name)).toLowerCase() === stem);
}

/** An MP3 can belong to either format. Require the lyric file when both exist. */
export async function useLrcPair(selected: string): Promise<boolean> {
  const extension = extname(selected).toLowerCase();
  if (extension !== '.mp3') return extension === '.lrc' || audioFormats.has(extension);
  const siblings = matchingSiblings(selected, await readdir(dirname(selected)));
  const hasLrc = siblings.some(name => extname(name).toLowerCase() === '.lrc');
  if (hasLrc && siblings.some(name => extname(name).toLowerCase() === '.cdg'))
    throw new Error('This MP3 has both LRC and CDG lyrics. Select the lyric file you want to import.');
  return hasLrc;
}

/** Require same-folder, case-insensitive matching without guessing among different audio files. */
export async function resolveLrcPair(selected: string): Promise<{ audio: string; lyrics: string }> {
  const extension = extname(selected).toLowerCase();
  const folder = dirname(selected);
  const siblings = matchingSiblings(selected, await readdir(folder));
  const lyrics = siblings.filter(name => extname(name).toLowerCase() === '.lrc');
  const audio = siblings.filter(name => {
    const candidate = extname(name).toLowerCase();
    return extension === '.lrc' ? audioFormats.has(candidate) : candidate === extension && audioFormats.has(candidate);
  });
  if (lyrics.length !== 1 || !audio.length) throw new Error('Place a unique LRC and a matching audio file with the same name in the same folder.');
  if (audio.length !== 1) throw new Error('More than one matching audio file was found. Select the specific audio file or move the duplicates.');
  return { audio: join(folder, audio[0]), lyrics: join(folder, lyrics[0]) };
}

async function probeAudioDuration(audio: string, format: string, signal: AbortSignal): Promise<number> {
  const ffprobe = await findFfmpegTool('ffprobe');
  if (!ffprobe) throw new Error('FFprobe was not found. Check the media tools in Preferences and install FFmpeg with FFprobe.');
  try {
    const { stdout } = await probe(ffprobe, [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', audio,
      '-select_streams', 'a:0', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json',
    ], { signal, killSignal: 'SIGKILL', timeout: 15_000, maxBuffer: 8192, windowsHide: true });
    const info = JSON.parse(stdout) as { streams?: { codec_type: string }[]; format?: { duration?: string } };
    const duration = Number(info.format?.duration);
    if (info.streams?.[0]?.codec_type === 'audio' && Number.isFinite(duration) && duration >= 0.001 && duration <= AUDIO_DURATION_LIMIT)
      return Math.floor(duration * 1000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('FFprobe was not found. Install FFmpeg with FFprobe and add both to PATH, then retry.');
  }
  throw new Error('The paired audio could not be read or is longer than two hours. Check the file and try again.');
}

/** Compose lyrics and backdrop on one video clock, so seek and resume use ordinary MP4 playback. */
export async function convertLrc(
  audio: string, lyrics: string, output: string, signal: AbortSignal, progress: (seconds: number) => void, backdropPath?: string,
): Promise<void> {
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(lyrics, { signal })); }
  catch { throw new Error('The staged lyrics could not be read as UTF-8. Save the LRC as UTF-8 and retry.'); }
  const parsed = parseLrc(source);
  const format = audioFormats.get(extname(audio).toLowerCase());
  if (!format) throw new Error('This LRC audio format is unsupported.');
  const duration = await probeAudioDuration(audio, format, signal);
  const captions = exportLrcWebVtt(parsed, duration);
  if (captions.text === 'WEBVTT\n\n') throw new Error('No timed lyric lines fall within the audio. Check the LRC timestamps and its matching audio file.');

  const directory = dirname(output);
  await writeFile(join(directory, 'lyrics.vtt'), captions.text, { signal, flag: 'wx', mode: 0o600 });
  const video = backdropPath
    ? ['-protocol_whitelist', 'file,pipe', '-stream_loop', '-1', '-f', 'mov', '-i', backdropPath]
    : ['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=25'];
  // Keep the filter filename fixed and relative to the private staging directory.
  // WebVTT escapes the original LRC as text before it reaches FFmpeg's subtitle renderer.
  const filter = 'fps=25:start_time=0,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,' +
    "subtitles=lyrics.vtt:force_style='FontName=Arial,Fontsize=22,Bold=1,Outline=2,Shadow=0,MarginV=28,MarginL=25,MarginR=25',format=yuv420p";
  await runFfmpegConversion([
    '-hide_banner', '-nostdin', '-v', 'error', '-n', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', audio,
    ...video, '-map', '1:v:0', '-map', '0:a:0', '-map_metadata', '-1', '-vf', filter,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-t', String(AUDIO_DURATION_LIMIT), '-movflags', '+faststart',
  ], output, signal, progress, {
    cwd: directory,
    installMessage: 'FFmpeg was not found. Add FFmpeg with libass, H.264 and AAC support to PATH, then retry.',
    decodeMessage: backdropPath
      ? 'FFmpeg could not render this LRC pair with the selected backdrop. Check libass support and the source files, or choose Solid Background and retry.'
      : 'FFmpeg could not render this LRC pair. Check the paired audio and use an FFmpeg build with libass, H.264 and AAC support.',
  });
}
