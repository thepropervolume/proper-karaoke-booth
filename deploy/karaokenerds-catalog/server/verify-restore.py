#!/usr/bin/env python3
"""Restore a catalog backup to a new disposable schema and compare data and DDL.

Requires root socket authentication. Never restores over the live catalog.
Uses a temporary account restricted to the disposable schema; prints no secrets.
"""
import gzip
import hashlib
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import tempfile

DATABASE = 'tpv_karaoke_catalog'
DIRECTORY = Path('/var/backups/tpv-karaoke-catalog/production')
TABLES = ['tpv_kn_version', 'tpv_kn_state', 'tpv_kn_brands', 'tpv_kn_videos', 'tpv_kn_dates']


def mysql(sql, defaults=None):
    options = [f'--defaults-file={defaults}'] if defaults else ['--no-defaults', '--user=root']
    result = subprocess.run(['mysql', *options, '--protocol=SOCKET', '--socket=/run/mysqld/mysqld.sock',
                             '--batch', '--raw', '--skip-column-names'], input=sql, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('Database command failed; no SQL or credentials were printed.')
    return result.stdout


def state(database):
    return mysql(f'SELECT SHA2(CAST(snapshot AS CHAR),256),JSON_LENGTH(snapshot,\'$.Items\'),'
                 f'last_attempt_ms,last_success_ms,attempt_token,import_sha256,sqlite_retired_ms,revision '
                 f'FROM `{database}`.tpv_kn_state ORDER BY id;')


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root using socket authentication.')
    os.umask(0o077)
    info = DIRECTORY.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('Unsafe backup directory.')
    backups = sorted(DIRECTORY.glob('catalog-production-*.sql.gz'))
    if not backups:
        raise RuntimeError('No catalog backup exists.')
    backup = backups[-1]
    info = backup.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise RuntimeError('Unsafe backup file.')
    suffix = secrets.token_hex(5)
    database, user = 'tpv_kn_restore_' + suffix, 'tpv_kn_restore_' + suffix
    password = secrets.token_hex(32)
    created_database = created_user = False
    # Compare an immutable snapshot of live state; concurrent updates invalidate
    # the check rather than treating a different catalog as a successful restore.
    before = state(DATABASE)
    try:
        mysql(f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;')
        created_database = True
        mysql(f"CREATE USER '{user}'@'localhost' IDENTIFIED BY '{password}';")
        created_user = True
        escaped = database.replace('_', '\\_')
        mysql(f"GRANT ALL PRIVILEGES ON `{escaped}`.* TO '{user}'@'localhost';")
        with tempfile.TemporaryDirectory(prefix='tpv-restore-', dir='/run/lock/tpv-karaoke-catalog') as directory:
            defaults = Path(directory) / 'restore.cnf'
            defaults.write_text(f'[client]\nuser={user}\npassword={password}\n[mysql]\ndatabase={database}\n')
            defaults.chmod(0o600)
            with gzip.open(backup, 'rt', encoding='utf-8') as dump:
                mysql(dump.read(), defaults)
        if before != state(database) or before != state(DATABASE):
            raise RuntimeError('Snapshot, revision or refresh-state comparison failed.')
        for table in TABLES:
            original = mysql(f'SHOW CREATE TABLE `{DATABASE}`.`{table}`;')
            restored = mysql(f'SHOW CREATE TABLE `{database}`.`{table}`;')
            if original != restored:
                raise RuntimeError('Restored schema comparison failed.')
            original_count = mysql(f'SELECT COUNT(*) FROM `{DATABASE}`.`{table}`;')
            restored_count = mysql(f'SELECT COUNT(*) FROM `{database}`.`{table}`;')
            if original_count != restored_count:
                raise RuntimeError('Restored table-count comparison failed.')
            original_hash = hashlib.sha256(mysql(f'SELECT * FROM `{DATABASE}`.`{table}` ORDER BY 1;').encode()).digest()
            restored_hash = hashlib.sha256(mysql(f'SELECT * FROM `{database}`.`{table}` ORDER BY 1;').encode()).digest()
            if original_hash != restored_hash:
                raise RuntimeError('Restored table-content comparison failed.')
    finally:
        if created_database:
            mysql(f'DROP DATABASE `{database}`;')
        if created_user:
            mysql(f"DROP USER '{user}'@'localhost';")
    print('PASS backup restore: schema, all table contents, snapshot hash, revision and refresh state match; temporary account/schema removed.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError):
        print('Catalog restore verification failed; inspect the isolated drill privately.', file=sys.stderr)
        sys.exit(1)
