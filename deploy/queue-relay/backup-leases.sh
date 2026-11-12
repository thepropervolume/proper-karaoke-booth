#!/usr/bin/env bash
# Private transaction-consistent dump of MySQL lease metadata only.
set -Eeuo pipefail
umask 077
[[ ${EUID} -eq 0 && $# -eq 0 ]] || { echo 'Run lease backup as root without arguments.' >&2; exit 64; }
db=tpv_queue_relay
defaults=/etc/tpv-queue-relay/backup.cnf
dir=/var/backups/tpv-queue-relay
lockdir=/run/lock/tpv-queue-relay
[[ -f $defaults && ! -L $defaults && $(stat -c '%u:%a' "$defaults") == '0:600' ]] || {
  echo 'Expected a root-owned mode 0600 regular MySQL defaults file.' >&2; exit 1;
}
for private_dir in "$dir" "$lockdir"; do
  [[ -d $private_dir && ! -L $private_dir && $(stat -c '%u:%a' "$private_dir") == '0:700' ]] || {
    echo 'Expected root-owned mode 0700 private backup and lock directories.' >&2; exit 1;
  }
done
lock="${lockdir}/database.lock"
[[ ! -L $lock ]] || { echo 'Refusing a symlink lock file.' >&2; exit 1; }
exec 9>"$lock"
flock -n 9 || { echo 'Another lease backup or migration is running.' >&2; exit 1; }
tmp=$(mktemp "${dir}/.dump.XXXXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT
if ! mysqldump --defaults-file="$defaults" --protocol=SOCKET --single-transaction \
  --quick --skip-lock-tables --no-tablespaces --skip-column-statistics --set-gtid-purged=OFF \
  --hex-blob --triggers --skip-routines --skip-events -- "$db" 2>/dev/null | gzip -c >"$tmp"; then
  echo 'Lease metadata dump failed; previous backups were preserved.' >&2; exit 1;
fi
gzip -t -- "$tmp"
[[ -s $tmp ]] || { echo 'Lease metadata backup is empty.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%S.%N)
final="${dir}/leases-${stamp}.sql.gz"
ln -- "$tmp" "$final"
rm -- "$tmp"
trap - EXIT
mapfile -d '' -t backups < <(find "$dir" -maxdepth 1 -type f -name 'leases-*.sql.gz' -print0 | sort -zr)
if (( ${#backups[@]} > 14 )); then
  for old in "${backups[@]:14}"; do rm -- "$old"; done
fi
printf 'Relay lease MySQL backup complete: %s\n' "$final"
