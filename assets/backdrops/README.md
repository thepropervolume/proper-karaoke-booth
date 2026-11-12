# Default lyrics backdrop

`tpv-karaoke-v3.mp4` is the bundled playback copy of the TPV animation selected by the project owner on 2026-11-12 for CD+G and future LRC backgrounds. The original is retained outside the repository and was not modified.

- Source filename: `TPV-Karaoke-Backdrop-Video (Version 3).mp4`
- Source size: 717,041,810 bytes.
- Source SHA-256: `e924b350f5000c9c0d660fa42a0f92c900859e1c79a5f6b9a2615eec3561f474`.
- Full animation retained: 551.633333 seconds, 1920 × 1080, 30 frames per second, 16:9.
- Playback copy: H.264, `yuv420p`, MP4 with fast-start metadata. Audio is deliberately removed so only the karaoke track is heard. No crop, trim, speed change, or logo replacement is applied.
- Playback size: 65,732,204 bytes (about 62.7 MiB, reduced from the 683.8 MiB original).
- Playback SHA-256: `eb8e2556c043404d1138cc33055ebb73d37979de1ddd8cbe303a84c18a8b789d`.
- Verified: all 16,549 frames are retained, only one video stream remains, the MP4 `moov` metadata precedes `mdat`, and sampled frames preserve the source composition.

The playback copy was encoded using FFmpeg 9.0.2 with:

```sh
ffmpeg -hide_banner -nostdin -n -i "TPV-Karaoke-Backdrop-Video (Version 3).mp4" \
  -map 0:v:0 -an -c:v libx264 -preset medium -crf 28 -threads 6 \
  -pix_fmt yuv420p -movflags +faststart -map_metadata -1 tpv-karaoke-v3.mp4
```

This is a compressed application asset, not an additional song-library item. CD+G uses it without its source audio; future LRC support should use the same configured backdrop. The backdrop does not imply that LRC playback is already implemented.
