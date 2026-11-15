#!/usr/bin/env bash
set -euo pipefail
umask 077
latest=
for path in /var/backups/gallant/gallant-*.dump; do
	[[ -f "$path" ]] || continue
	[[ -z "$latest" || "$path" -nt "$latest" ]] && latest=$path
done
[[ -n "$latest" ]]
/opt/gallant-dashboard/current/deploy/restore-test.sh "$latest"
install -d -m 700 /var/lib/gallant-ops
touch /var/lib/gallant-ops/restore-success
