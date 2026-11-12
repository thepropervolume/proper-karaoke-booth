#!/usr/bin/env python3
"""Verify a private MySQL rating dump in a new disposable schema.

Requires root socket authentication and an inactive ratings service. A fresh dump
taken after stopping that service is compared to the unchanged source. Restore SQL runs
under an account restricted to the disposable schema, never the live schema.
"""
import argparse
import fcntl
import gzip
import hashlib
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import tempfile

DATABASE = 'tpv_song_ratings'
DIRECTORY = Path('/var/backups/tpv-song-ratings')
LOCK_DIRECTORY = Path('/run/lock/tpv-song-ratings')
MAX_DUMP_BYTES = 256 * 1024 * 1024


def mysql(sql, defaults=None):
    options = [f'--defaults-file={defaults}'] if defaults else ['--no-defaults', '--user=root']
    result = subprocess.run(['mysql', *options, '--protocol=SOCKET', '--socket=/run/mysqld/mysqld.sock',
                             '--batch', '--raw', '--skip-column-names', '--connect-timeout=5'],
                            input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError('Database command failed; no SQL or credentials were printed.')
    return result.stdout


def private_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('Unsafe private recovery directory.')


def identifiers(sql):
    names = mysql(sql).splitlines()
    if any(not re.fullmatch(r'[A-Za-z0-9_]{1,64}', value) for value in names):
        raise RuntimeError('Unrecognized schema identifier.')
    return names


def tables(database):
    return identifiers(f"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='{database}' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;")


def fingerprint(database, table):
    columns = identifiers(f"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{database}' AND TABLE_NAME='{table}' ORDER BY ORDINAL_POSITION;")
    keys = identifiers(f"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{database}' AND TABLE_NAME='{table}' AND COLUMN_KEY='PRI' ORDER BY ORDINAL_POSITION;")
    if not columns or not keys:
        raise RuntimeError('Recovery verification requires a recognized primary key.')
    binary_columns = set(identifiers(f"SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='{database}' AND TABLE_NAME='{table}' AND DATA_TYPE IN('binary','varbinary','tinyblob','blob','mediumblob','longblob') ORDER BY ORDINAL_POSITION;"))
    expression = ','.join(f'HEX(`{column}`)' if column in binary_columns else f'`{column}`' for column in columns)
    order = ','.join(f'`{column}`' for column in keys)
    data = mysql(f'SELECT JSON_ARRAY({expression}) FROM `{database}`.`{table}` ORDER BY {order};')
    return (mysql(f'SHOW CREATE TABLE `{database}`.`{table}`;'),
            mysql(f'SELECT COUNT(*) FROM `{database}`.`{table}`;'),
            hashlib.sha256(data.encode('utf-8')).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', required=True,
                        help='Create and remove a disposable schema/account for this recovery drill.')
    parser.add_argument('--backup', type=Path, help='Private dump in the configured backup directory; defaults to newest.')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Run as root with socket authentication.')
    if subprocess.run(['systemctl', 'is-active', '--quiet', 'tpv-song-ratings.service'], capture_output=True).returncode == 0:
        raise RuntimeError('Stop the ratings service and take a fresh backup before comparing restored contents.')
    os.umask(0o077)
    private_directory(DIRECTORY)
    private_directory(LOCK_DIRECTORY)
    lock = LOCK_DIRECTORY / 'database.lock'
    lock_fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    lock_info = os.fstat(lock_fd)
    if not stat.S_ISREG(lock_info.st_mode) or lock_info.st_uid != 0 or stat.S_IMODE(lock_info.st_mode) != 0o600:
        raise RuntimeError('Unsafe recovery lock.')
    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    candidates = sorted(DIRECTORY.glob('ratings-*.sql.gz'))
    backup = args.backup if args.backup else candidates[-1] if candidates else None
    if backup is None or not backup.is_absolute() or backup.parent != DIRECTORY:
        raise RuntimeError('No recognized backup path was selected.')
    info = backup.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_DUMP_BYTES:
        raise RuntimeError('Unsafe backup file.')
    source_tables = tables(DATABASE)
    if not source_tables:
        raise RuntimeError('Source schema is not initialized.')
    before = {table: fingerprint(DATABASE, table) for table in source_tables}
    suffix = secrets.token_hex(6)
    database, user = 'tpv_sr_restore_' + suffix, 'tpv_srr_' + suffix
    password = secrets.token_hex(32)
    created_database = created_user = False
    try:
        mysql(f'CREATE DATABASE `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;')
        created_database = True
        mysql(f"CREATE USER '{user}'@'localhost' IDENTIFIED WITH caching_sha2_password BY '{password}';")
        created_user = True
        escaped = database.replace('_', '\\_')
        mysql(f"GRANT ALL PRIVILEGES ON `{escaped}`.* TO '{user}'@'localhost';")
        with tempfile.TemporaryDirectory(prefix='restore-', dir=LOCK_DIRECTORY) as directory:
            defaults = Path(directory) / 'restore.cnf'
            defaults.write_text(f'[client]\nuser={user}\npassword={password}\nsocket=/run/mysqld/mysqld.sock\n[mysql]\ndatabase={database}\n')
            defaults.chmod(0o600)
            with gzip.open(backup, 'rt', encoding='utf-8') as dump:
                sql = dump.read(MAX_DUMP_BYTES + 1)
            if len(sql.encode('utf-8')) > MAX_DUMP_BYTES:
                raise RuntimeError('Decompressed dump exceeds its configured bound.')
            mysql(sql, defaults)
        if tables(database) != source_tables or tables(DATABASE) != source_tables:
            raise RuntimeError('Restored table names or unchanged source tables differ.')
        for table in source_tables:
            if before[table] != fingerprint(database, table) or before[table] != fingerprint(DATABASE, table):
                raise RuntimeError('Restored DDL, row count or rating content comparison failed.')
    finally:
        try:
            if created_database:
                mysql(f'DROP DATABASE `{database}`;')
        finally:
            if created_user:
                mysql(f"DROP USER '{user}'@'localhost';")
            os.close(lock_fd)
    print('PASS ratings MySQL restore: schema, row counts and all rating contents match; disposable schema/account removed.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError):
        print('Ratings MySQL restore verification failed; inspect the private recovery drill. No credentials were printed.', file=sys.stderr)
        sys.exit(1)
