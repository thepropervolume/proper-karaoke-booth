#!/usr/bin/env python3
"""Provision the standalone Booth identity database and private mailer credentials."""
import argparse
import grp
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys

CONFIG = Path('/etc/tpv-queue-relay')
DB = 'tpv_booth_accounts'
ROLE = 'tpv_booth_runtime'
MAIL_SENDER_SOURCE = Path('/etc/tpv/staging.json')
FILES = ('booth-accounts.password', 'booth-account-mail.token', 'booth-account-mail.json')
MYSQL = ['mysql', '--no-defaults', '--protocol=SOCKET', '--socket=/run/mysqld/mysqld.sock',
         '--user=root', '--batch', '--raw', '--skip-column-names', '--connect-timeout=5']


def mysql(sql):
    result = subprocess.run(MYSQL, input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('MySQL operation failed. Inspect the database privately.')
    return result.stdout.strip()


def write_private(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        stream.write(value + '\n')
        stream.flush()
        os.fsync(stream.fileno())


def check_sender_file(path):
    info = path.lstat()
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or (mode != 0o600 and
            not (mode == 0o640 and info.st_gid == grp.getgrnam('www-data').gr_gid)):
        raise RuntimeError('Website sender config must be root-owned and private.')


def sender_config():
    check_sender_file(MAIL_SENDER_SOURCE)
    with MAIL_SENDER_SOURCE.open(encoding='utf-8') as stream:
        source = json.load(stream)
    sender = source.get('public_accounts_email_from')
    envelope = source.get('public_accounts_envelope_from')
    address = r'[A-Za-z0-9._+\-]{1,64}@thepropervolume\.com'
    if not all(isinstance(value, str) and re.fullmatch(address, value) for value in (sender, envelope)):
        raise RuntimeError('The configured Workspace sender is missing or invalid.')
    if source.get('public_accounts_smtp_host', 'smtp-relay.gmail.com') != 'smtp-relay.gmail.com':
        raise RuntimeError('The existing sender is not configured for the supported Workspace relay.')
    return {'sender': sender, 'envelope': envelope}


def operation():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', required=True, action='store_true')
    parser.parse_args()
    info = CONFIG.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
        raise RuntimeError('Booth account config expects a root-owned mode 0700 directory.')
    marker = CONFIG / '.booth-account-provisioning'
    if any(os.path.lexists(path) for path in (marker, *(CONFIG / name for name in FILES))):
        raise RuntimeError('Booth credential or provisioning files already exist. Preserve and verify them.')
    existing = mysql(f"SELECT (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{DB}')+"
                     f"(SELECT COUNT(*) FROM mysql.user WHERE User='{ROLE}');")
    if existing != '0':
        raise RuntimeError('Booth database or runtime name already exists. Refusing to adopt existing data.')
    sender = sender_config()
    schema = Path(__file__).with_name('booth-accounts.sql').read_text(encoding='utf-8')
    password = secrets.token_hex(32)
    mail_token = secrets.token_urlsafe(32)
    grant = DB.replace('_', r'\_')
    write_private(marker, 'incomplete Booth account provisioning')
    mysql(f"CREATE DATABASE {DB} CHARACTER SET utf8mb4;\nUSE {DB};\n{schema}\n"
          f"CREATE USER '{ROLE}'@'localhost' IDENTIFIED BY '{password}';\n"
          f"GRANT SELECT, INSERT, UPDATE, DELETE ON `{grant}`.* TO '{ROLE}'@'localhost';")
    write_private(CONFIG / FILES[0], password)
    write_private(CONFIG / FILES[1], mail_token)
    write_private(CONFIG / FILES[2], json.dumps(sender, separators=(',', ':')))
    marker.unlink()
    print('Provisioned the isolated Booth account schema and private files.')


if __name__ == '__main__':
    try:
        if os.getuid() != 0:
            raise RuntimeError('Booth account provisioning requires the database administrator.')
        operation()
    except (OSError, RuntimeError, ValueError) as error:
        # Do not print SQL, configuration content, or a traceback containing a secret.
        print(str(error) if isinstance(error, RuntimeError) else 'Unable to provision Booth accounts.', file=sys.stderr)
        sys.exit(1)