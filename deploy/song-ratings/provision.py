#!/usr/bin/env python3
"""Provision a separate song ratings schema and private credentials through root socket auth.

Private voter exports are preserved on recognized reruns. Existing unmanaged or incomplete state is refused.
SQL containing passwords is supplied through stdin and never printed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys

CONFIG = Path('/etc/tpv-song-ratings')
BACKUP = Path('/var/backups/tpv-song-ratings')
LOCK = Path('/run/lock/tpv-song-ratings')
SOCKET = '/run/mysqld/mysqld.sock'
CREDENTIAL_EXPORT = 'tpv-song-ratings-db-credentials-2026-11-12.json'
DATABASE = 'tpv_song_ratings'
# MySQL database-level grants interpret underscore as a wildcard even in backticks.
GRANT_DATABASE = DATABASE.replace('_', '\\_')
ROLES = {
    'runtime': ('tpv_sr_runtime', ['SELECT', 'INSERT', 'UPDATE', 'DELETE']),
    'migrator': ('tpv_sr_migrator', ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'REFERENCES', 'INDEX', 'ALTER']),
    'backup': ('tpv_sr_backup', ['SELECT', 'SHOW VIEW', 'TRIGGER']),
}
PRIVILEGE_COLUMNS = {
    'SELECT': 'Select_priv', 'INSERT': 'Insert_priv', 'UPDATE': 'Update_priv',
    'DELETE': 'Delete_priv', 'CREATE': 'Create_priv', 'REFERENCES': 'References_priv',
    'INDEX': 'Index_priv', 'ALTER': 'Alter_priv', 'SHOW VIEW': 'Show_view_priv',
    'TRIGGER': 'Trigger_priv',
}
ALL_DB_COLUMNS = [
    'Select_priv', 'Insert_priv', 'Update_priv', 'Delete_priv', 'Create_priv',
    'Drop_priv', 'Grant_priv', 'References_priv', 'Index_priv', 'Alter_priv',
    'Create_tmp_table_priv', 'Lock_tables_priv', 'Create_view_priv', 'Show_view_priv',
    'Create_routine_priv', 'Alter_routine_priv', 'Execute_priv', 'Event_priv', 'Trigger_priv',
]


def fail(message):
    raise RuntimeError(message)


def mysql(sql, defaults=None):
    config = [f'--defaults-file={defaults}'] if defaults else ['--no-defaults']
    command = ['mysql', *config, '--protocol=SOCKET', f'--socket={SOCKET}',
               '--batch', '--raw', '--skip-column-names', '--connect-timeout=5']
    if not defaults:
        command.append('--user=root')
    result = subprocess.run(command, input=sql, text=True, capture_output=True, check=False)
    if result.returncode:
        fail('MySQL operation failed; inspect server configuration privately. No credentials were printed.')
    return result.stdout.rstrip('\n')


def safe_parent(path):
    for item in [path, *path.parents]:
        if not item.exists() and not item.is_symlink():
            continue
        info = item.lstat()
        sticky_lock_parent = item == Path('/run/lock') and info.st_mode & stat.S_ISVTX
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not sticky_lock_parent):
            fail(f'Unsafe directory: {item}')


def private_directory(path, create=False):
    safe_parent(path.parent)
    if not path.exists() and not path.is_symlink():
        if not create:
            fail(f'Missing private directory: {path}')
        path.mkdir(mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        fail(f'Expected root-owned mode 0700 directory: {path}')


def private_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        fail(f'Expected root-owned mode 0600 regular file: {path}')
    return path.read_bytes()


def write_private(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data.encode('utf-8'))
        stream.flush()
        os.fsync(stream.fileno())


def database_exists():
    return mysql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{DATABASE}';") == '1'


def existing_accounts():
    names = ','.join(f"'{user}'" for user, _ in ROLES.values())
    return mysql(f'SELECT User,Host,plugin FROM mysql.user WHERE User IN ({names}) ORDER BY User,Host;')


def verify():
    private_directory(CONFIG)
    if (CONFIG / '.provisioning').exists() or (CONFIG / '.provisioning').is_symlink():
        fail('Incomplete provisioning marker exists; inspect and reconcile privately before retrying.')
    manifest = json.loads(private_file(CONFIG / 'managed.json'))
    if manifest.get('schemaVersion') != 1 or manifest.get('database') != DATABASE:
        fail('Unrecognized provisioning manifest.')
    expected_names = {'production.env', CREDENTIAL_EXPORT}
    for role in ROLES:
        expected_names.update({f'{role}.password', f'production-{role}.cnf'})
    if not isinstance(manifest.get('sha256'), dict) or set(manifest['sha256']) != expected_names:
        fail('Incomplete provisioning manifest.')
    for name, digest in manifest['sha256'].items():
        if hashlib.sha256(private_file(CONFIG / name)).hexdigest() != digest:
            fail(f'Managed credential/configuration changed: {name}; inspect privately.')
    if not database_exists():
        fail('Managed ratings database is missing.')
    expected = sorted(f'{user}\tlocalhost\tcaching_sha2_password' for user, _ in ROLES.values())
    if existing_accounts().splitlines() != expected:
        fail('Ratings MySQL account identities or authentication plugins changed.')
    for role, (user, privileges) in ROLES.items():
        grantee = f"CONCAT(CHAR(39),'{user}',CHAR(39),'@',CHAR(39),'localhost',CHAR(39))"
        # mysql.db exposes privilege flags without reading authentication hashes.
        rows = mysql(f"SELECT Db,{','.join(ALL_DB_COLUMNS)} FROM mysql.db WHERE User='{user}' AND Host='localhost';").splitlines()
        allowed = {PRIVILEGE_COLUMNS[privilege] for privilege in privileges}
        wanted = '\t'.join([GRANT_DATABASE, *('Y' if column in allowed else 'N' for column in ALL_DB_COLUMNS)])
        if rows != [wanted]:
            fail(f'Unexpected database grants for ratings {role} account.')
        checks = [
            f"SELECT COUNT(*) FROM information_schema.USER_PRIVILEGES WHERE GRANTEE={grantee} AND PRIVILEGE_TYPE<>'USAGE';",
            f"SELECT COUNT(*) FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE={grantee};",
            f"SELECT COUNT(*) FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE={grantee};",
            f"SELECT COUNT(*) FROM mysql.role_edges WHERE TO_USER='{user}' AND TO_HOST='localhost';",
            f"SELECT COUNT(*) FROM mysql.global_grants WHERE USER='{user}' AND HOST='localhost';",
            f"SELECT COUNT(*) FROM mysql.procs_priv WHERE User='{user}' AND Host='localhost';",
            f"SELECT COUNT(*) FROM mysql.proxies_priv WHERE User='{user}' AND Host='localhost';",
        ]
        if mysql(''.join(checks)).splitlines() != ['0'] * len(checks):
            fail(f'Unexpected additional grants for ratings {role} account.')
        identity = mysql('SELECT CURRENT_USER(),DATABASE();', CONFIG / f'production-{role}.cnf')
        if identity != f'{user}@localhost\t{DATABASE}':
            fail(f'Ratings {role} credential verification failed.')
    private_directory(BACKUP)
    private_directory(LOCK)
    print('Managed ratings database, account grants and private files verified.')


def provision():
    safe_parent(CONFIG.parent)
    if CONFIG.exists() or CONFIG.is_symlink():
        private_directory(CONFIG)
        if (CONFIG / 'managed.json').exists():
            verify()
            return
        reserved = {'production.env', '.provisioning', CREDENTIAL_EXPORT}
        for role in ROLES:
            reserved.update({f'{role}.password', f'production-{role}.cnf'})
        if any((CONFIG / name).exists() or (CONFIG / name).is_symlink() for name in reserved):
            fail('Unmanaged ratings database files exist; refusing to overwrite or adopt them.')
    if database_exists() or existing_accounts():
        fail('Ratings database or account name already exists without this manifest; refusing to adopt or alter it.')
    private_directory(CONFIG, create=True)
    # A failed or interrupted apply intentionally leaves this marker for manual review.
    write_private(CONFIG / '.provisioning', 'incomplete ratings provisioning\n')
    files = {}
    passwords = {}
    for role, (user, _) in ROLES.items():
        password = secrets.token_hex(32)
        passwords[role] = password
        files[f'{role}.password'] = password + '\n'
        files[f'production-{role}.cnf'] = f'[client]\nuser={user}\npassword={password}\nsocket={SOCKET}\n[mysql]\ndatabase={DATABASE}\n'
    files['production.env'] = f'TPV_RATINGS_MYSQL_SOCKET={SOCKET}\nTPV_RATINGS_MYSQL_DATABASE={DATABASE}\n'
    files[CREDENTIAL_EXPORT] = json.dumps({'schemaVersion': 1, 'database': DATABASE, 'socket': SOCKET,
        'accounts': {role: {'username': user, 'password': passwords[role]} for role, (user, _) in ROLES.items()}}, indent=2) + '\n'
    for name, value in files.items():
        write_private(CONFIG / name, value)
    sql = [f'CREATE DATABASE `{DATABASE}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;']
    for role, (user, privileges) in ROLES.items():
        sql.append(f"CREATE USER '{user}'@'localhost' IDENTIFIED WITH caching_sha2_password BY '{passwords[role]}';")
        sql.append(f"GRANT {', '.join(privileges)} ON `{GRANT_DATABASE}`.* TO '{user}'@'localhost';")
    mysql('\n'.join(sql))
    for parent in [BACKUP, LOCK]:
        private_directory(parent, create=True)
    manifest = {'schemaVersion': 1, 'database': DATABASE,
                'sha256': {name: hashlib.sha256(value.encode('utf-8')).hexdigest() for name, value in files.items()}}
    write_private(CONFIG / 'managed.json', json.dumps(manifest, indent=2) + '\n')
    (CONFIG / '.provisioning').unlink()
    verify()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true', help='Create a new isolated schema, accounts and private files; verify recognized reruns.')
    mode.add_argument('--check', action='store_true', help='Verify an existing managed deployment without changes.')
    args = parser.parse_args()
    if os.geteuid() != 0:
        fail('Run through the root socket-authenticated operator account.')
    os.umask(0o077)
    provision() if args.apply else verify()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print(f'Ratings provisioning stopped: {error}', file=sys.stderr)
        sys.exit(1)
