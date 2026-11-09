#!/usr/bin/env bash
# REVIEW TEMPLATE. Install only after reviewing the accompanying README.
set -Eeuo pipefail
umask 077

if [[ ${EUID} -ne 0 || $# -ne 1 ]]; then
  echo 'Usage: run as root with exactly one argument: production or staging' >&2
  exit 64
fi
case "$1" in
  production) db=tpv_karaoke_catalog; keep=14 ;;
  staging) db=tpv_karaoke_catalog_staging; keep=7 ;;
  *) echo 'Environment must be production or staging.' >&2; exit 64 ;;
esac
environment=$1
defaults="/etc/tpv-karaoke-catalog/${environment}-backup.cnf"
dir="/var/backups/tpv-karaoke-catalog/${environment}"
lockdir="/run/lock/tpv-karaoke-catalog"
lock="${lockdir}/${environment}.lock"

# Paths must be provisioned ahead of time; reject symlinks and unsafe ownership/modes.
[[ -f $defaults && ! -L $defaults && $(stat -c '%u:%a' "$defaults") == '0:600' ]] || {
  echo 'Expected a root-owned, mode 0600, regular MySQL defaults file.' >&2; exit 1;
}
[[ -d $dir && ! -L $dir && $(stat -c '%u:%a' "$dir") == '0:700' ]] || {
  echo 'Expected a root-owned, mode 0700 backup directory.' >&2; exit 1;
}
[[ -d $lockdir && ! -L $lockdir && $(stat -c '%u:%a' "$lockdir") == '0:700' ]] || {
  echo 'Expected a pre-provisioned root-owned, mode 0700 lock directory.' >&2; exit 1;
}
# This private directory ensures an unprivileged user cannot pre-create lock symlinks.
for lockfile in "${lockdir}/backup-global.lock" "$lock"; do
  [[ ! -L $lockfile ]] || { echo 'Refusing a symlink lock file.' >&2; exit 1; }
done
command -v mysqldump >/dev/null
command -v gzip >/dev/null
command -v flock >/dev/null
exec 8>"${lockdir}/backup-global.lock"
flock -n 8 || { echo 'Another catalog backup is running.' >&2; exit 1; }
exec 9>"$lock"
flock -n 9 || { echo "Another ${environment} backup or migration is running." >&2; exit 1; }

tmp=$(mktemp "${dir}/.dump.XXXXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT
# Dumps tables, views, and triggers only. All schema changes must hold the same lock.
mysqldump --defaults-file="$defaults" --protocol=SOCKET --single-transaction \
  --quick --skip-lock-tables --no-tablespaces --skip-column-statistics --set-gtid-purged=OFF \
  --hex-blob --triggers --skip-routines --skip-events -- "$db" | gzip -c >"$tmp"
gzip -t -- "$tmp"
[[ -s $tmp ]] || { echo 'Backup is empty.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%S.%N)
final="${dir}/catalog-${environment}-${stamp}.sql.gz"
# Hard-link publication is atomic and fails instead of overwriting an existing file.
ln -- "$tmp" "$final"
rm -- "$tmp"
trap - EXIT

# Delete only older, regular files matching this environment after successful publication.
# UTC timestamp names sort in chronological order; whitespace is safe through NUL delimiters.
mapfile -d '' -t backups < <(find "$dir" -maxdepth 1 -type f -name "catalog-${environment}-*.sql.gz" -print0 | sort -zr)
if (( ${#backups[@]} > keep )); then
  for old in "${backups[@]:keep}"; do rm -- "$old"; done
fi
printf 'Catalog %s backup complete: %s\n' "$environment" "$final"
