#!/usr/bin/env bash
# Run on the VPS as root after copying a built release and provisioning its secrets.
set -euo pipefail
umask 022
release=${1:?Usage: activate.sh /opt/gallant-dashboard/releases/RELEASE}
case "$release" in
/opt/gallant-dashboard/releases/*) ;;
*)
	printf 'Release must be under /opt/gallant-dashboard/releases/\n' >&2
	exit 2
	;;
esac
[[ -f "$release/dist/server/server/main.js" && -f "$release/dist/web/index.html" ]]
[[ -f /etc/gallant-dashboard.env && -f /etc/gallant-postgres.env ]]
if ! id gallant >/dev/null 2>&1; then useradd --system --home-dir /opt/gallant-dashboard --shell /usr/sbin/nologin gallant; fi
cd "$release"
pnpm install --prod --frozen-lockfile --package-import-method=copy
# Cached pnpm package modes can be restrictive; only public release files live here.
chown -R root:root "$release"
chmod -R go-w,a+rX "$release"
runuser -u gallant -- node --input-type=module -e 'await import("fastify"); await import("drizzle-orm");'
docker compose -f deploy/compose.yml up -d --wait --wait-timeout 300
"$release/deploy/backup.sh"
# Node reads the protected environment directly; secrets never enter command arguments.
node --env-file=/etc/gallant-dashboard.env dist/server/server/migrate.js
previous=$(readlink -e /opt/gallant-dashboard/current || true)
ln -sfn "$release" /opt/gallant-dashboard/current.next
mv -Tf /opt/gallant-dashboard/current.next /opt/gallant-dashboard/current
install -m 644 deploy/gallant-web.service deploy/gallant-worker.service deploy/gallant-backup.service deploy/gallant-backup.timer deploy/gallant-monitor.service deploy/gallant-monitor.timer deploy/gallant-restore-check.service deploy/gallant-restore-check.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable gallant-web gallant-worker gallant-backup.timer
systemctl restart gallant-web gallant-worker
systemctl start gallant-backup.timer
systemctl enable --now gallant-monitor.timer gallant-restore-check.timer
ready=false
for _attempt in {1..30}; do
	if curl -fsS --max-time 5 http://127.0.0.1:3100/ready >/dev/null; then
		ready=true
		break
	fi
	sleep 2
done
if [[ $ready != true ]]; then
	printf 'Release failed readiness; restoring previous application release.\n' >&2
	if [[ -n $previous && -d $previous ]]; then
		if [[ ! -f "$previous/deploy/share-policy-v1" ]]; then
			restricted=$(docker exec gallant-postgres psql -U gallant -d gallant -Atqc "SELECT count(*) FROM members WHERE share_token IS NOT NULL AND share_policy IS NOT NULL")
			if [[ "$restricted" != 0 ]]; then
				systemctl stop gallant-web
				printf 'Unsafe rollback blocked: prior release ignores active sharing restrictions.\n' >&2
				exit 1
			fi
		fi
		ln -sfn "$previous" /opt/gallant-dashboard/current.next
		mv -Tf /opt/gallant-dashboard/current.next /opt/gallant-dashboard/current
		systemctl restart gallant-web gallant-worker
	else
		systemctl stop gallant-web gallant-worker
	fi
	exit 1
fi
printf 'Release activated: %s\nPrevious release: %s\n' "$release" "$previous"
