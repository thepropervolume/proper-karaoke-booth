# LRC conversion proof

This is a development experiment, not an application feature. The host cannot
yet import or play an MP3/LRC pair through this code. The proof uses the
existing LRC parser and line-level WebVTT export, then asks FFmpeg to render
the lyrics over a supplied video backdrop and combine them with the MP3 audio
in a new MP4. Enhanced LRC word markers are not rendered as word highlighting;
the result reports when enhanced timing was omitted.

To run the synthetic Linux rehearsal from the repository root:

```sh
npm ci
npx tsx --test tests/domain/lrc.test.ts tests/domain/lrc-vtt.test.ts tests/main/lrc-conversion-proof.test.ts
```

The media tests require FFprobe and an FFmpeg build with the `subtitles` filter
(libass), `libx264`, AAC and `libmp3lame`. They skip when these prerequisites
are unavailable. They generate temporary media; no personal songs or external
services are needed. The checks inspect frames at several seek positions,
including lyric and clear cues, and verify decoded audio, source preservation,
invalid input, cancellation before starting, and refusal to overwrite output.

These checks do not establish speaker output, physical audio/lyric sync,
pause/resume, real-world producer files, other operating systems, or full
application integration. Before using the approach in a host importer, add
an explicit and unambiguous pair-selection workflow, managed job lifecycle,
solid-background support, progress and cancellation handling, duplicate and
uncertain-result recovery, safe cleanup, and an actual singer-display
rehearsal. The proof also relies on hard-link support in the output filesystem.
