#!/usr/bin/env python3
"""Restricted SSH entry point for accepting and publishing verified Booth packages."""

import argparse
import fcntl
import html
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time


VERSION = r'(?:0|[1-9][0-9]{0,11})\.(?:0|[1-9][0-9]{0,11})\.(?:0|[1-9][0-9]{0,11})'
JOB = re.compile(rf'(?P<operation>upload|publish) (?P<version>{VERSION}) '
                 r'(?P<commit>[0-9a-f]{40}) (?P<run>[1-9][0-9]{0,19}) '
                 r'(?P<attempt>[1-9][0-9]{0,5}) (?P<scope>win|linux|mac|android|ios|planning|[0-9a-f]{64})')
STAGING = re.compile(rf'[1-9][0-9]{{0,19}}\.[1-9][0-9]{{0,5}}\.v{VERSION}\.[0-9a-f]{{40}}')
SCOPES = ('win', 'linux', 'mac', 'android', 'ios', 'planning')
RETAIN_RELEASES = 5
GIB = 1024 ** 3
STAGING_LIMIT = 8 * GIB
DISK_RESERVE = 5 * GIB
STAGING_TTL_SECONDS = 24 * 60 * 60
BUFFER_SIZE = 1024 ** 2
MAX_TEXT_ASSET = 4 * BUFFER_SIZE
TAR_BLOCK = 512
TAR_END = bytes(TAR_BLOCK)
CODE = Path(__file__).resolve().parent


def node(node_binary, script, *arguments, capture=False):
    return subprocess.run(
        [str(node_binary), str(CODE / script), *(str(argument) for argument in arguments)],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE if capture else None, text=True,
        check=True, timeout=180, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'},
    ).stdout


def asset_names(node_binary, version, scope):
    return set(json.loads(node(node_binary, 'publish-release.mjs', 'names', version, scope, capture=True)))


def maintain_staging(incoming):
    """Called with the staging lock while no upload or publication can modify the tree."""
    used = 0
    expires = time.time() - STAGING_TTL_SECONDS
    for session in incoming.iterdir():
        if not STAGING.fullmatch(session.name) or not session.is_dir() or session.is_symlink():
            continue
        if session.stat().st_mtime < expires:
            shutil.rmtree(session)
            continue
        for path in session.rglob('*'):
            if path.is_file() and not path.is_symlink():
                used += path.stat().st_size
    available = shutil.disk_usage(incoming).free
    return min(STAGING_LIMIT - used, available - DISK_RESERVE)


def read_exact(stream, length):
    data = stream.read(length)
    if len(data) != length:
        raise ValueError('The upload ended before its declared length.')
    return data


def extract_tar(stream, destination, names, budget):
    """Accept plain, flat USTAR files only. Never run tar extraction on supplied paths."""
    received = set()
    while (header := read_exact(stream, TAR_BLOCK)) != TAR_END:
        if header[257:263] != b'ustar\0' or header[156:157] not in (tarfile.REGTYPE, tarfile.AREGTYPE):
            raise ValueError('Expected a flat USTAR archive of regular release files.')
        info = tarfile.TarInfo.frombuf(header, 'ascii', 'strict')
        if info.name not in names or info.name in received:
            raise ValueError('The upload contains an unapproved or duplicate release filename.')
        if not 0 < info.size < 2 * GIB or info.size > budget:
            raise ValueError('The upload exceeds the available release staging space or file size limit.')
        if info.name.endswith(('.json', '.txt')) and info.size > MAX_TEXT_ASSET:
            raise ValueError('A release receipt exceeds the metadata size limit.')
        received.add(info.name)
        budget -= info.size
        with (destination / info.name).open('xb') as output:
            remaining = info.size
            while remaining:
                block = read_exact(stream, min(remaining, BUFFER_SIZE))
                output.write(block)
                remaining -= len(block)
        padding = read_exact(stream, -info.size % TAR_BLOCK)
        if any(padding):
            raise ValueError('Invalid release archive padding.')
    if read_exact(stream, TAR_BLOCK) != TAR_END:
        raise ValueError('The release archive is missing its end markers.')
    trailer = stream.read(BUFFER_SIZE + 1)
    if len(trailer) > BUFFER_SIZE or any(trailer) or received != names:
        raise ValueError('The upload is incomplete or has trailing data.')


def upload(session, version, scope, node_binary, budget):
    target = session / scope
    if target.exists():
        raise ValueError('This build was already uploaded. Start a new full workflow attempt if needed.')
    names = asset_names(node_binary, version, scope)
    with tempfile.TemporaryDirectory(dir=session, prefix='upload-') as scratch:
        candidate = Path(scratch) / 'verified-names'
        candidate.mkdir(mode=0o700)
        extract_tar(sys.stdin.buffer, candidate, names, budget)
        candidate.rename(target)
    print(f'Staged {scope} for Booth {version}.', flush=True)


def version_parts(version):
    return tuple(int(number) for number in version.split('.'))


def published_versions(public):
    return [path.name[1:] for path in public.iterdir() if path.is_dir() and not path.is_symlink()
            and re.fullmatch(f'v{VERSION}', path.name)]


def manifest_for(directory, version):
    """Validate metadata before using an existing release as an archive or redirect target."""
    manifest_path = directory / 'release-manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > MAX_TEXT_ASSET:
        raise ValueError('A release has missing or invalid metadata.')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('version') != version or not re.fullmatch(r'[0-9a-f]{40}', manifest.get('sourceCommit', '')):
        raise ValueError('A release has inconsistent identity metadata.')
    if not isinstance(manifest.get('artifacts'), list):
        raise ValueError('A release has invalid artifact metadata.')
    return manifest


def write_latest_map(directory, version, output):
    """Only allow local, existing release assets to become versionless redirects."""
    manifest = manifest_for(directory, version)
    aliases = {}
    files = [record.get('file') if isinstance(record, dict) else None for record in manifest['artifacts']]
    files.extend(['release-manifest.json', 'SHA256SUMS.txt'])
    for name in files:
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9._-]*', name):
            raise ValueError('Invalid release asset name for latest redirect.')
        file = directory / name
        if file.is_symlink() or not file.is_file():
            raise ValueError('Missing release asset for latest redirect.')
        alias = name.replace(f'-{version}-', '-', 1)
        if alias in aliases:
            raise ValueError('Release assets conflict on their latest redirect name.')
        aliases[alias] = f'/v{version}/{name}'
    output.write_text(''.join(f'{key} {target}\n' for key, target in sorted(aliases.items())), encoding='ascii')
    output.chmod(0o644)


def archive_page(directory, version, manifest):
    """Display preserved release notes as text, never as executable markup."""
    notes = []
    for file in sorted(directory.iterdir()):
        if re.search(r'(?:release[-_ ]?notes|changelog)', file.name, re.I):
            if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_TEXT_ASSET:
                raise ValueError('Invalid archived release notes.')
            notes.append((file.name, file.read_text(encoding='utf-8')))
    body = ''.join(
        f'<section class="card release-notes"><h2>{html.escape(name)}</h2>'
        f'<pre>{html.escape(content)}</pre></section>'
        for name, content in notes
    )
    commit = html.escape(manifest['sourceCommit'], quote=True)
    version = html.escape(version)
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Karaoke Booth {version} archive · The Proper Volume</title>
  <link rel="icon" href="/assets/karaoke-booth.png">
  <link rel="stylesheet" href="/assets/releases.css">
</head>
<body>
  <a class="skip-link" href="#release-notes">Skip to release notes</a>
  <header class="site-header"><div class="shell topbar">
    <a class="brand" href="https://thepropervolume.com/">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="/assets/tpv-wordmark-night.svg">
        <img src="/assets/tpv-wordmark-day.svg" width="144" height="48" alt="The Proper Volume">
      </picture>
    </a>
    <a href="/">All downloads</a>
  </div></header>
  <main class="shell" id="release-notes">
    <section class="hero release-hero">
      <div class="hero-copy">
        <p class="eyebrow">Archived release {version}</p>
        <h1>Karaoke Booth release notes</h1>
        <p class="lede">Installer downloads are available for the five latest versions.</p>
      </div>
      <img class="product-icon" src="/assets/karaoke-booth.png" width="96" height="96" alt="">
    </section>
    {body}
    <footer class="release-footer">
      <a href="release-manifest.json">Release manifest</a>
      <a href="../../">Latest Booth downloads</a>
      <a href="https://github.com/thepropervolume/proper-karaoke-booth/commit/{commit}">Source commit <code>{commit[:7]}</code></a>
    </footer>
  </main>
</body>
</html>
'''


def write_archive_page(directory, version, manifest):
    page = directory / 'index.html'
    page.write_text(archive_page(directory, version, manifest), encoding='utf-8')
    page.chmod(0o644)


def archive_release(public, version, scratch):
    """Keep textual release metadata/notes when a version's downloads are pruned."""
    source = public / f'v{version}'
    if source.is_symlink() or not source.is_dir():
        raise ValueError('A release selected for archiving is not a directory.')
    manifest = manifest_for(source, version)
    archive_root = public / 'archive'
    if archive_root.is_symlink() or (archive_root.exists() and not archive_root.is_dir()):
        raise ValueError('The release archive is invalid.')
    archive_root.mkdir(mode=0o700, exist_ok=True)
    # The publisher's private umask also applies to mkdir inside the public tree.
    archive_root.chmod(0o755)
    target = archive_root / f'v{version}'
    extensions = {'.md', '.markdown', '.rst', '.txt', '.json', '.html', '.htm', '.yaml', '.yml'}
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_dir() or (target / 'release-manifest.json').is_symlink() or not (target / 'release-manifest.json').is_file():
            raise ValueError('An existing release archive is invalid.')
        if (target / 'release-manifest.json').read_bytes() != (source / 'release-manifest.json').read_bytes():
            raise ValueError('An existing release archive has different metadata.')
        # A previous interrupted publish may have made an archive already. Do
        # not discard notes that were added or changed since that archive.
        for file in source.iterdir():
            if file.suffix.lower() not in extensions:
                continue
            archived_file = target / ('original-download-page.html.txt' if file.name == 'index.html' else file.name)
            if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_TEXT_ASSET or archived_file.is_symlink() or not archived_file.is_file() or archived_file.read_bytes() != file.read_bytes():
                raise ValueError('An existing release archive does not preserve all current metadata.')
        target.chmod(0o755)
        return
    candidate = scratch / f'archive-v{version}'
    candidate.mkdir(mode=0o700)
    for file in source.iterdir():
        if file.suffix.lower() not in extensions:
            continue
        if file.is_symlink() or not file.is_file() or file.stat().st_size > MAX_TEXT_ASSET:
            raise ValueError('Invalid textual release metadata; the release was not pruned.')
        # Keep the old page as text so links to removed installers are not offered.
        name = 'original-download-page.html.txt' if file.name == 'index.html' else file.name
        shutil.copyfile(file, candidate / name, follow_symlinks=False)
        (candidate / name).chmod(0o644)
    write_archive_page(candidate, version, manifest)
    candidate.chmod(0o755)
    candidate.rename(target)


def render_page(node_binary, manifest, destination, is_version_page=False, history=(), archived=()):
    flags = ['--version-page'] if is_version_page else []
    if history:
        flags.extend(['--history', ','.join(history)])
    if archived:
        flags.extend(['--archived', ','.join(archived)])
    node(node_binary, 'scripts/render-downloads.mjs', manifest, destination, *flags)
    destination.chmod(0o644)


def prepare_release(session, directory, node_binary, version, commit, source_hash):
    directory.mkdir(mode=0o755)
    for scope in SCOPES:
        stage = session / scope
        names = asset_names(node_binary, version, scope)
        if not stage.is_dir() or set(os.listdir(stage)) != names:
            raise ValueError(f'Required {scope} upload is missing for this workflow attempt.')
        for name in names:
            file = stage / name
            if file.is_symlink() or not file.is_file():
                raise ValueError('The staged release contains an invalid file.')
            # The scratch tree and incoming uploads share the release filesystem.
            os.link(file, directory / name, follow_symlinks=False)
    node(node_binary, 'publish-release.mjs', 'verify', version, directory, commit, source_hash)
    render_page(node_binary, directory / 'release-manifest.json', directory / 'index.html', is_version_page=True)
    for entry in directory.iterdir():
        entry.chmod(0o444)
    directory.chmod(0o755)


def publish(session, public, version, commit, source_hash, node_binary):
    target = public / f'v{version}'
    versions = published_versions(public)
    latest = max(versions, key=version_parts, default=None)
    with tempfile.TemporaryDirectory(dir=session, prefix='publish-') as scratch:
        scratch = Path(scratch)
        if target.exists():
            if target.is_symlink() or not target.is_dir():
                raise ValueError('The release path is not a version directory.')
            published_commit = node(node_binary, 'publish-release.mjs', 'identity', version, target, capture=True).strip()
            if published_commit != commit:
                raise ValueError('This release version already belongs to another source commit.')
            candidate = target
        else:
            if latest and version_parts(version) < version_parts(latest):
                raise ValueError('A newer version is already published.')
            candidate = scratch / 'release'
            prepare_release(session, candidate, node_binary, version, commit, source_hash)

        # Archive old metadata before pruning any release, and never make the
        # newest page or shortcuts refer to versions about to be removed.
        update_latest = latest is None or version_parts(version) >= version_parts(latest)
        combined = sorted(set(versions + [version]), key=version_parts, reverse=True)
        keep, prune = combined[:RETAIN_RELEASES], combined[RETAIN_RELEASES:]
        for past in prune:
            archive_release(public, past, scratch)
        if update_latest:
            index = scratch / 'index.html'
            history = [past for past in keep if version_parts(past) < version_parts(version)]
            archive_root = public / 'archive'
            archived = [path.name[1:] for path in archive_root.iterdir() if path.is_dir() and not path.is_symlink()
                        and re.fullmatch(f'v{VERSION}', path.name) and path.name[1:] not in keep] if archive_root.exists() else []
            render_page(node_binary, candidate / 'release-manifest.json', index, history=history, archived=archived)
            latest_map = scratch / '.latest.map'
            write_latest_map(candidate, version, latest_map)
        if candidate != target:
            candidate.rename(target)
        if update_latest:
            latest_map.replace(public / '.latest.map')
            index.replace(public / 'index.html')
        for past in prune:
            path = public / f'v{past}'
            if path.is_symlink() or not path.is_dir():
                raise ValueError('A release selected for pruning changed unexpectedly.')
            shutil.rmtree(path)
    shutil.rmtree(session)
    print(f'Published Booth {version} ({commit}).', flush=True)


def timeout(_signum, _frame):
    raise TimeoutError('Release command exceeded its allotted time.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, default=Path('/srv/tpv-booth-releases'))
    parser.add_argument('--node', type=Path, default=Path('/opt/tpv-song-ratings/node'))
    args = parser.parse_args()
    command = JOB.fullmatch(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if command is None:
        raise ValueError('Unrecognized release command.')
    operation, version, commit, run, attempt, scope = command.groups()
    if (operation == 'upload') != (scope in SCOPES):
        raise ValueError('The release command has an invalid scope.')
    state = args.state.resolve(strict=True)
    incoming, public = (state / 'incoming').resolve(strict=True), (state / 'public').resolve(strict=True)
    if incoming != state / 'incoming' or public != state / 'public' or incoming.stat().st_dev != public.stat().st_dev:
        raise ValueError('Private staging and public releases must share the configured filesystem.')
    session = incoming / f'{run}.{attempt}.v{version}.{commit}'
    os.umask(0o077)
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(1500)
    with (incoming / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        budget = maintain_staging(incoming)
        if operation == 'upload':
            if budget <= 0:
                raise ValueError('There is no release staging space available.')
            session.mkdir(mode=0o700, exist_ok=True)
            upload(session, version, scope, args.node, budget)
        else:
            session.mkdir(mode=0o700, exist_ok=True)
            publish(session, public, version, commit, scope, args.node)


if __name__ == '__main__':
    try:
        main()
    except (OSError, UnicodeError, tarfile.HeaderError, ValueError, subprocess.SubprocessError) as error:
        sys.exit(f'Release command failed: {error}')
