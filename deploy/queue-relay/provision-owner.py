#!/usr/bin/env python3
"""Create one private host owner capability. Never print credentials or embed them in builds."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import uuid

BASE = Path('/etc/tpv-queue-relay')


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError()
    return path.read_text('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', required=True, help='Short local filename label for this host; never a secret.')
    args = parser.parse_args()
    if os.geteuid() != 0 or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,46}[a-z0-9]', args.label):
        raise ValueError()
    os.umask(0o077)
    if not BASE.exists():
        BASE.mkdir(mode=0o700)
    info = BASE.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError()
    registry = BASE / 'owners.json'
    owners = json.loads(private_file(registry)) if registry.exists() else {'owners': []}
    if not isinstance(owners, dict) or set(owners) != {'owners'} or not isinstance(owners['owners'], list) or len(owners['owners']) >= 100:
        raise ValueError()
    for owner in owners['owners']:
        if not isinstance(owner, dict) or set(owner) != {'id','tokenSha256'} or str(uuid.UUID(owner['id'])) != owner['id'] or not re.fullmatch(r'[a-f0-9]{64}',owner['tokenSha256']):
            raise ValueError()
    output = BASE / (args.label + '-host.json')
    token = secrets.token_urlsafe(32)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        json.dump({'baseUrl':'https://queue.thepropervolume.com','ownerToken':token},stream,indent=2)
        stream.write('\n');stream.flush();os.fsync(stream.fileno())
    owners['owners'].append({'id':str(uuid.uuid4()),'tokenSha256':hashlib.sha256(token.encode()).hexdigest()})
    temporary = BASE / ('.owners-' + secrets.token_hex(12))
    try:
        descriptor = os.open(temporary,os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,0o600)
        with os.fdopen(descriptor,'w') as stream:
            json.dump(owners,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,registry)
        descriptor=os.open(BASE,os.O_RDONLY | os.O_DIRECTORY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)
    finally:temporary.unlink(missing_ok=True)
    print('Created one private per-host relay configuration and hash-only owner registry. Reload the relay before using a newly added owner.')


if __name__ == '__main__':
    try:main()
    except Exception:
        print('Relay owner provisioning failed; inspect private configuration and existing state. No credentials were printed.',file=sys.stderr)
        sys.exit(1)
