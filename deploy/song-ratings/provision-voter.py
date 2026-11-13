#!/usr/bin/env python3
"""Provision one separate voter capability and private desktop export; print no secrets."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import uuid

BASE = Path('/etc/tpv-song-ratings')
LOCK = Path('/run/lock/tpv-song-ratings')
ORIGIN = 'https://apps.thepropervolume.com'


def private_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError()


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError()
    return path.read_text('utf-8')


def mysql(sql):
    defaults = BASE / 'production-migrator.cnf'
    private_file(defaults)
    result = subprocess.run(['mysql', f'--defaults-file={defaults}', '--protocol=SOCKET',
                             '--socket=/run/mysqld/mysqld.sock', '--batch', '--raw',
                             '--skip-column-names', '--connect-timeout=5'],
                            input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        raise ValueError()
    return result.stdout.rstrip('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default='host-rating.json', help='Private export basename; default host-rating.json.')
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}\.json', args.name):
        raise ValueError()
    os.umask(0o077)
    private_directory(BASE)
    private_directory(LOCK)
    managed = json.loads(private_file(BASE / 'managed.json'))
    if managed.get('database') != 'tpv_song_ratings' or managed.get('schemaVersion') != 1:
        raise ValueError()
    lock_fd = os.open(LOCK / 'database.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    lock_info = os.fstat(lock_fd)
    if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != 0 or stat.S_IMODE(lock_info.st_mode) != 0o600:
        raise ValueError()
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if mysql('SELECT DATABASE(); SELECT version FROM schema_version WHERE id=1;') != 'tpv_song_ratings\n1':
        raise ValueError()
    output = BASE / args.name
    if output.exists() or output.is_symlink():
        client = json.loads(private_file(output))
        if not isinstance(client, dict) or set(client) != {'baseUrl', 'token'} or client['baseUrl'] != ORIGIN or not isinstance(client['token'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', client['token']):
            raise ValueError()
    else:
        client = {'baseUrl': ORIGIN, 'token': secrets.token_urlsafe(32)}
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(client, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        descriptor = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    digest = hashlib.sha256(client['token'].encode('ascii')).hexdigest()
    existing = mysql(f"SELECT disabled FROM voters WHERE token_hash=UNHEX('{digest}');")
    if existing:
        if existing != '0':
            # A rerun never silently re-enables a revoked voter.
            raise ValueError()
    else:
        voter_id = str(uuid.uuid4())
        # Do not use ON DUPLICATE KEY UPDATE: a unique token collision must fail
        # rather than updating a different voter. Reruns look up the same hash.
        mysql(f"INSERT INTO voters(voter_id,token_hash,disabled) VALUES('{voter_id}',UNHEX('{digest}'),0);")
        if mysql(f"SELECT disabled FROM voters WHERE token_hash=UNHEX('{digest}');") != '0':
            raise ValueError()
    os.close(lock_fd)
    print(f'Private voter configuration provisioned or verified at {output}; no credential value was printed.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        print('Voter provisioning stopped; inspect private configuration, schema, revocation and account access. No credentials were printed.', file=sys.stderr)
        sys.exit(1)
