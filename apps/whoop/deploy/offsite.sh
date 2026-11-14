#!/usr/bin/env bash
# Called only after a successful local backup. The recipient's private key stays off this VPS.
set -euo pipefail
umask 077
dump=${1:?Usage: offsite.sh /path/to/backup.dump}
config=${GALLANT_OFFSITE_CONFIG:-/etc/gallant-backup-offsite.env}
ops_dir=${GALLANT_OPS_DIR:-/var/lib/gallant-ops}
if [[ ! -f "$config" ]]; then
	printf 'Off-server backup is not configured.\n' >&2
	exit 3
fi
[[ $(stat -c '%u:%a' "$config") == "$EUID:600" ]]
# shellcheck source=/dev/null
source "$config"
: "${BACKUP_HOST:?}" "${BACKUP_DIR:?}" "${BACKUP_RECIPIENT:?}"
[[ "$BACKUP_HOST" =~ ^[A-Za-z0-9_@.:-]+$ && "$BACKUP_DIR" =~ ^/[A-Za-z0-9_./-]+$ ]]
command -v age >/dev/null
command -v rsync >/dev/null
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
name=$(basename "$dump").age
age -r "$BACKUP_RECIPIENT" -o "$temporary/$name" "$dump"
# Destination must already exist; no remote shell interpolation or host-key bypass.
rsync --protect-args -e 'ssh -o BatchMode=yes -o ConnectTimeout=15' -- "$temporary/$name" "$BACKUP_HOST:$BACKUP_DIR/"
install -d -m 700 "$ops_dir"
touch "$ops_dir/offsite-success"
printf 'Encrypted off-server backup uploaded.\n'
