#!/usr/bin/env python3
"""Restricted SSH entry point for accepting and publishing verified Booth packages."""

import argparse
import fcntl
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
                 r'(?P<attempt>[1-9][0-9]{0,5}) (?P<scope>win|linux|mac|planning|[0-9a-f]{64})')
STAGING = re.compile(rf'[1-9][0-9]{{0,19}}\.[1-9][0-9]{{0,5}}\.v{VERSION}\.[0-9a-f]{{40}}')
SCOPES = ('win', 'linux', 'mac', 'planning')
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


def render_page(node_binary, manifest, destination, is_version_page=False):
    flags = ['--version-page'] if is_version_page else []
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
    latest = max(published_versions(public), key=version_parts, default=None)
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

        # Build the latest page before publishing the immutable version directory.
        update_latest = latest is None or version_parts(version) >= version_parts(latest)
        if update_latest:
            index = scratch / 'index.html'
            render_page(node_binary, candidate / 'release-manifest.json', index)
        if candidate != target:
            candidate.rename(target)
        if update_latest:
            index.replace(public / 'index.html')
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
