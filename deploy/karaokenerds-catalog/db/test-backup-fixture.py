#!/usr/bin/env python3
"""Exercise a path-rewritten backup-script copy with fake mysqldump, entirely under /tmp."""
from pathlib import Path
import fcntl
import gzip
import os
import subprocess
import tempfile

SOURCE = Path(__file__).with_name('backup-catalog.sh')
assert os.geteuid() == 0, 'The template checks EUID and root-owned paths.'

with tempfile.TemporaryDirectory(prefix='tpv-catalog-backup-test-', dir='/tmp') as root:
    root = Path(root)
    etc = root / 'etc'
    backups = root / 'backups'
    locks = root / 'locks'
    fakebin = root / 'bin'
    for directory in (etc, backups, locks, fakebin):
        directory.mkdir(mode=0o700)
    for environment in ('production', 'staging'):
        (backups / environment).mkdir(mode=0o700)
        config = etc / f'{environment}-backup.cnf'
        config.write_text('[client]\nuser=fixture\n')
        config.chmod(0o600)
    mock = fakebin / 'mysqldump'
    mock.write_text('#!/bin/sh\nif [ "${MOCK_DUMP_FAIL:-0}" = 1 ]; then echo "fixture dump failure" >&2; exit 17; fi\nprintf "%s\\n" "-- fixture SQL" "CREATE TABLE fixture (id int);"\n')
    mock.chmod(0o700)
    text = SOURCE.read_text()
    replacements = {
        '/etc/tpv-karaoke-catalog': str(etc),
        '/var/backups/tpv-karaoke-catalog': str(backups),
        '/run/lock/tpv-karaoke-catalog': str(locks),
    }
    for old, new in replacements.items():
        assert old in text, f'Unexpected backup template: missing {old}'
        text = text.replace(old, new)
    script = root / 'backup-fixture.sh'
    script.write_text(text)
    script.chmod(0o700)
    env = os.environ.copy()
    env['PATH'] = f'{fakebin}:/usr/bin:/bin'

    def run(environment='production', *, fail_dump=False, ok=True):
        e = env.copy()
        if fail_dump:
            e['MOCK_DUMP_FAIL'] = '1'
        result = subprocess.run([str(script), environment], env=e, capture_output=True, text=True, timeout=10)
        if (result.returncode == 0) != ok:
            raise AssertionError(f'Unexpected exit {result.returncode}, stdout={result.stdout!r}, stderr={result.stderr!r}')
        return result

    prod = backups / 'production'
    stage = backups / 'staging'
    run()
    files = list(prod.glob('catalog-production-*.sql.gz'))
    assert len(files) == 1
    assert gzip.open(files[0], 'rt').read() == '-- fixture SQL\nCREATE TABLE fixture (id int);\n'
    assert files[0].stat().st_mode & 0o777 == 0o600
    assert not list(prod.glob('.dump.*'))
    print('PASS successful gzip, fixture contents, permissions, and cleanup')

    for index in range(16):
        p = prod / f'catalog-production-20200101T{index:06}.000000000.sql.gz'
        with gzip.open(p, 'wt') as out:
            out.write('fixture old backup')
    run()
    assert len(list(prod.glob('catalog-production-*.sql.gz'))) == 14
    assert not (prod / 'catalog-production-20200101T000000.000000000.sql.gz').exists()
    for index in range(9):
        p = stage / f'catalog-staging-20200101T{index:06}.000000000.sql.gz'
        with gzip.open(p, 'wt') as out:
            out.write('fixture old backup')
    run('staging')
    assert len(list(stage.glob('catalog-staging-*.sql.gz'))) == 7
    assert len(list(prod.glob('catalog-production-*.sql.gz'))) == 14
    print('PASS independent production/staging retention and isolation')

    before = {p.name: p.read_bytes() for p in prod.iterdir() if p.is_file()}
    run(fail_dump=True, ok=False)
    after = {p.name: p.read_bytes() for p in prod.iterdir() if p.is_file()}
    assert after == before, 'Failed dump changed prior backups or left a temporary file.'
    print('PASS failed dump preserves previous backups and cleans temporary output')

    for name in ('backup-global.lock', 'production.lock'):
        with (locks / name).open('a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = run(ok=False)
            assert 'running' in result.stderr
            fcntl.flock(handle, fcntl.LOCK_UN)
    print('PASS global and environment locks reject concurrent backup')

    config = etc / 'production-backup.cnf'
    config.chmod(0o644)
    assert '0600' in run(ok=False).stderr
    config.chmod(0o600)
    prod.chmod(0o755)
    assert '0700 backup directory' in run(ok=False).stderr
    prod.chmod(0o700)
    locks.chmod(0o755)
    assert '0700 lock directory' in run(ok=False).stderr
    locks.chmod(0o700)
    lockfile = locks / 'production.lock'
    lockfile.unlink()
    lockfile.symlink_to(root / 'decoy')
    assert 'symlink lock file' in run(ok=False).stderr
    assert not (root / 'decoy').exists()
    print('PASS unsafe config, backup directory, lock directory, and symlink rejection')

print('All fixture tests passed; no real MySQL, /etc, /run, or /var paths were used.')
