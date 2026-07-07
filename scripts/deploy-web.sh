#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

deploy_host="${DEPLOY_SSH_HOST:-auth}"
remote_web_dir="${REMOTE_WEB_DIR:-/var/www/3plates}"
export_dir="${WEB_EXPORT_DIR:-/tmp/3plates-prod-web-export}"
public_api_url="${EXPO_PUBLIC_API_URL:-https://api.3spinningplates.com}"
ssh_connect_timeout_seconds="${SSH_CONNECT_TIMEOUT_SECONDS:-30}"
ssh_timeout_retry_delay_seconds="${SSH_TIMEOUT_RETRY_DELAY_SECONDS:-30}"
ssh_timeout_retries="${SSH_TIMEOUT_RETRIES:-2}"

ssh_opts=(
	-o "ConnectTimeout=${ssh_connect_timeout_seconds}"
	-o ServerAliveInterval=10
	-o ServerAliveCountMax=2
	-o BatchMode=yes
)

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		printf 'Missing required command: %s\n' "$1" >&2
		exit 1
	fi
}

is_timeout_output() {
	grep -Eqi 'timed out|timeout' "$1"
}

run_with_timeout_retries() {
	local description="$1"
	shift

	local attempt=0
	local output_file
	output_file="$(mktemp)"

	while true; do
		if "$@" >"$output_file" 2>&1; then
			cat "$output_file"
			rm -f "$output_file"
			return 0
		fi

		local status=$?

		if is_timeout_output "$output_file" && ((attempt < ssh_timeout_retries)); then
			attempt=$((attempt + 1))
			printf '%s timed out. Waiting %ss before retry %s of %s.\n' \
				"$description" \
				"$ssh_timeout_retry_delay_seconds" \
				"$attempt" \
				"$ssh_timeout_retries" >&2
			sleep "$ssh_timeout_retry_delay_seconds"
			: >"$output_file"
			continue
		fi

		cat "$output_file" >&2
		rm -f "$output_file"
		return "$status"
	done
}

require_command pnpm
require_command ssh
require_command rsync
require_command grep
require_command curl

printf 'Building web export in %s\n' "$export_dir"
rm -rf "$export_dir"
EXPO_PUBLIC_API_URL="$public_api_url" pnpm --dir apps/mobile exec expo export \
	--platform web \
	--clear \
	--output-dir "$export_dir"

if [[ ! -f "$export_dir/index.html" ]]; then
	printf 'Missing web export index.html in %s\n' "$export_dir" >&2
	exit 1
fi

if ! grep -R -q "$public_api_url" "$export_dir/_expo/static/js/web"; then
	printf 'Web export does not contain expected API URL: %s\n' "$public_api_url" >&2
	exit 1
fi

backup_path="$(
	run_with_timeout_retries "Remote backup" \
		ssh "${ssh_opts[@]}" "$deploy_host" \
		"set -e; backup=\"${remote_web_dir}.backup-\$(date +%Y%m%d%H%M%S)\"; cp -a \"${remote_web_dir}\" \"\$backup\"; printf '%s\n' \"\$backup\""
)"
printf 'Created remote backup: %s\n' "$backup_path"

rsync_ssh="ssh -o ConnectTimeout=${ssh_connect_timeout_seconds} -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o BatchMode=yes"
run_with_timeout_retries "Web export sync" \
	rsync -az --delete -e "$rsync_ssh" "$export_dir"/ "$deploy_host:$remote_web_dir"/

curl -fsSI --max-time 20 https://3spinningplates.com/progress >/dev/null
curl -fsSI --max-time 20 https://3spinningplates.com/workouts >/dev/null

printf 'Deployed web export to %s:%s\n' "$deploy_host" "$remote_web_dir"
