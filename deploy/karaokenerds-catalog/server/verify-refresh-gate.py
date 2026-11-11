#!/usr/bin/env python3
"""Check the explicit operator gate before the updater can use its upstream credential."""
import json
from pathlib import Path
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
    expected = {'legacyUpdatersStopped': True, 'importAndCooldownVerified': True, 'singleUpdaterConfirmed': True}
    if json.loads(gate.read_text('utf-8')) != expected:
        raise ValueError()
    upstream = base / 'upstream.url'
    info = upstream.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or not 1 <= info.st_size <= 16384:
        raise ValueError()
except (OSError, ValueError):
    print('Catalog refresh is disabled: verify retirement, imported cooldown and private upstream configuration.', file=sys.stderr)
    sys.exit(1)
