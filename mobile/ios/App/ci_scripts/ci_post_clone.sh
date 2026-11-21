#!/bin/bash
set -euo pipefail

repo_root="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
cd "$repo_root"

# GitHub installs this version before calling the hook. Xcode Cloud images may
# have a different version, so use the official macOS archive in that case.
node_version=v24.15.0
if [[ "$(node --version 2>/dev/null || true)" != "$node_version" ]]; then
  if [[ "$(uname -s)" != Darwin ]]; then
    printf 'Install Node.js %s before preparing iOS assets on this host.\n' "$node_version" >&2
    exit 1
  fi
  case "$(uname -m)" in
    arm64)
      node_arch=arm64
      node_sha256=372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4
      ;;
    x86_64)
      node_arch=x64
      node_sha256=ffd5ee293467927f3ee731a553eb88fd1f48cf74eebc2d74a6babe4af228673b
      ;;
    *)
      printf 'Unsupported macOS architecture for Node.js %s.\n' "$node_version" >&2
      exit 1
      ;;
  esac
  node_dir="$(mktemp -d "${TMPDIR:-/tmp}/tpv-xcode-node.XXXXXXXX")"
  trap 'rm -rf -- "$node_dir"' EXIT
  node_bundle="node-$node_version-darwin-$node_arch"
  node_archive="$node_bundle.tar.gz"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --retry 3 --connect-timeout 15 --output "$node_dir/$node_archive" \
    "https://nodejs.org/dist/$node_version/$node_archive"
  (
    cd "$node_dir"
    printf '%s  %s\n' "$node_sha256" "$node_archive" | shasum -a 256 -c
    tar -xzf "$node_archive"
  )
  export PATH="$node_dir/$node_bundle/bin:$PATH"
fi

if [[ "$(node --version)" != "$node_version" ]]; then
  printf 'Expected Node.js %s for the mobile build.\n' "$node_version" >&2
  exit 1
fi

npm ci --no-audit --no-fund
npm ci --prefix mobile --no-audit --no-fund
npm run typecheck
npm --prefix mobile run typecheck
npm run build:mobile
cd mobile
npx --no-install cap sync ios
