#!/usr/bin/env python3
"""Check the explicit operator gate before the updater can use its upstream credential."""
import json
from pathlib import Path
import re
import stat
import sys

base = Path('/etc/tpv-karaoke-catalog')
try:
    directory = base.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != 0 or stat.S_IMODE(directory.st_mode) != 0o700:
        raise ValueError()
    gate = base / 'refresh-enabled.json'
    info = gate.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1024:
        raise ValueError()
    config = json.loads(gate.read_text('utf-8'))
    if not isinstance(config, dict) or config.get('legacyUpdatersStopped') is not True or config.get('singleUpdaterConfirmed') is not True:
        raise ValueError()
    if set(config) == {'legacyUpdatersStopped', 'importAndCooldownVerified', 'singleUpdaterConfirmed'}:
        if config['importAndCooldownVerified'] is not True:
            raise ValueError()
    elif set(config) == {'legacyUpdatersStopped', 'seededHandoff', 'singleUpdaterConfirmed'}:
        handoff = config['seededHandoff']
        if not isinstance(handoff, dict) or set(handoff) != {'seedSha256', 'quiescenceVerifiedAtMs'}:
            raise ValueError()
        digest, cutoff = handoff['seedSha256'], handoff['quiescenceVerifiedAtMs']
        if not isinstance(digest, str) or re.fullmatch(r'[a-f0-9]{64}', digest) is None or type(cutoff) is not int or not 0 < cutoff <= (2**53 - 1) - 86_400_000:
            raise ValueError()
    else:
        raise ValueError()
    upstream = base / 'upstream.url'
    info = upstream.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or not 1 <= info.st_size <= 16384:
        raise ValueError()
except (OSError, ValueError):
    print('Catalog refresh is disabled: verify sole ownership, imported cooldown or seeded handoff, and private upstream configuration.', file=sys.stderr)
    sys.exit(1)
