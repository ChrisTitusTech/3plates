#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 1 || ! -f $1 ]]; then
	printf 'Usage: %s /var/backups/gallant/gallant-TIMESTAMP.dump\n' "$0" >&2
	exit 2
fi
# This script only restores to a newly created scratch database, never production.
scratch_db="gallant_restore_$(date +%s)_$$"
cleanup() { docker exec gallant-postgres dropdb -U gallant --if-exists "$scratch_db"; }
trap cleanup EXIT
docker exec gallant-postgres createdb -U gallant "$scratch_db"
docker exec -i gallant-postgres pg_restore -U gallant -d "$scratch_db" --no-owner --exit-on-error <"$1"
docker exec gallant-postgres psql -U gallant -d "$scratch_db" -v ON_ERROR_STOP=1 -Atc "SELECT 'Restored members=' || count(*) FROM members; SELECT 'Restored records=' || count(*) FROM records;"
printf 'Backup restored successfully to an isolated scratch database.\n'
