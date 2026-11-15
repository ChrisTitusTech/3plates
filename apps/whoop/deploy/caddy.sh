#!/usr/bin/env bash
set -euo pipefail
config=/etc/caddy/Caddyfile.active
if grep -Eq '^whoop\.3spinningplates\.com[[:space:]]*\{' "$config"; then
	printf 'WHOOP virtual host already exists; no changes made.\n'
	exit 0
fi
backup="$config.before-gallant-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$config" "$backup"
rollback() {
	if [[ $1 -ne 0 ]]; then
		cat "$backup" >"$config"
		docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
		printf 'Caddy configuration restored from %s\n' "$backup" >&2
	fi
}
trap 'rollback "$?"' EXIT
# Preserve the inode because this file is bind-mounted into the live Caddy container.
cat >>"$config" <<'CADDY'

whoop.3spinningplates.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}
CADDY
docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
printf 'WHOOP route added. Caddy backup: %s\n' "$backup"
