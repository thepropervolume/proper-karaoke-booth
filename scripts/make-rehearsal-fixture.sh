#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  printf 'Usage: %s OUTPUT.mp4\nCreates a synthetic audiovisual test file; it contains a tone.\n' "$0" >&2
  exit 2
fi
if [[ -e "$1" ]]; then
  printf 'Refusing to overwrite %s\n' "$1" >&2
  exit 1
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=640x360:rate=30' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 20 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart "$1"
