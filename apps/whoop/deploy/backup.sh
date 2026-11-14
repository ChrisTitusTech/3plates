#!/usr/bin/env bash
set -euo pipefail
umask 077
backup_dir=/var/backups/gallant
install -d -m 700 "$backup_dir"
backup_path="$backup_dir/gallant-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary=$(mktemp "$backup_dir/.pending.XXXXXX")
trap 'rm -f "$temporary"' EXIT
docker exec gallant-postgres pg_dump -U gallant -d gallant --format=custom >"$temporary"
docker exec -i gallant-postgres pg_restore --list <"$temporary" >/dev/null
mv "$temporary" "$backup_path"
find "$backup_dir" -maxdepth 1 -type f -name 'gallant-*.dump' -mmin +20160 -delete
printf 'Backup verified: %s\n' "$backup_path"

if [[ -f /etc/gallant-backup-offsite.env ]]; then
	"$(dirname "$0")/offsite.sh" "$backup_path"
fi
