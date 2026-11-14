#!/usr/bin/env bash
set -euo pipefail
umask 077
install -d -m 700 /var/lib/gallant-ops
issues=()
curl -fsS --max-time 10 http://127.0.0.1:3100/ready >/dev/null 2>&1 || issues+=("Application readiness failed")
if ! find /var/backups/gallant -maxdepth 1 -name 'gallant-*.dump' -mmin -2160 -print -quit | read -r _; then
	issues+=("No local backup within 36 hours")
fi
if [[ ! -f /var/lib/gallant-ops/restore-success ]] || [[ $(find /var/lib/gallant-ops/restore-success -mmin +11520 -print) ]]; then
	issues+=("No successful restore verification within eight days")
fi
# Off-server copies are optional; monitor freshness only when configured.
if [[ -f /etc/gallant-backup-offsite.env ]]; then
	if [[ ! -f /var/lib/gallant-ops/offsite-success ]] || [[ $(find /var/lib/gallant-ops/offsite-success -mmin +2160 -print) ]]; then
		issues+=("No off-server backup within 36 hours")
	fi
fi
if failures=$(docker exec gallant-postgres psql -U gallant -d gallant -Atqc "SELECT count(*) FROM members m WHERE connected AND (last_sync IS NULL OR last_sync < now() - interval '48 hours' OR EXISTS (SELECT 1 FROM jobs j WHERE j.member_id=m.id AND status='failed'))"); then
	[[ "$failures" == 0 ]] || issues+=("Connected accounts have failed imports or stale synchronization")
else
	issues+=("Unable to check synchronization health")
fi
message="Healthy"
if (("${#issues[@]}")); then message=$(printf '%s\n' "${issues[@]}"); fi
previous=$(cat /var/lib/gallant-ops/status 2>/dev/null || true)
printf '%s\n' "$message" >/var/lib/gallant-ops/status
if [[ "$message" != "$previous" ]]; then
	printf '%s\n' "$message"
	# Optional root-owned delivery hook accepts a generic status on stdin, never member data.
	if [[ -x /etc/gallant-alert ]] && [[ $(stat -c '%u' /etc/gallant-alert) == 0 ]] && [[ -z $(find /etc/gallant-alert -perm /022 -print) ]]; then
		if ! printf '%s\n' "$message" | /etc/gallant-alert; then
			printf '%s\n' "$previous" >/var/lib/gallant-ops/status
			exit 1
		fi
	fi
fi
(("${#issues[@]}" == 0))
