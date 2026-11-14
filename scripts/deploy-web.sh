#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

deploy_host="${DEPLOY_SSH_HOST:-auth}"
remote_web_dir="${REMOTE_WEB_DIR:-/var/www/3plates}"
export_dir="${WEB_EXPORT_DIR:-}"
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

	local status
	while true; do
		if "$@" >"$output_file" 2>&1; then
			cat "$output_file"
			rm -f "$output_file"
			return 0
		else
			status=$?
		fi

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

# Restrict remote shell/rsync inputs to a literal host and absolute directory.
if [[ ! "$deploy_host" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$ ]] ||
	[[ ! "$remote_web_dir" =~ ^(/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*){2,}$ ]] ||
	[[ "$remote_web_dir" == *'/../'* || "$remote_web_dir" == */.. ]]; then
	printf 'Invalid deployment host or remote web directory.\n' >&2
	exit 1
fi
for value in "$ssh_connect_timeout_seconds" "$ssh_timeout_retry_delay_seconds" "$ssh_timeout_retries"; do
	if [[ ! "$value" =~ ^(0|[1-9][0-9]*)$ ]]; then
		printf 'SSH timeout and retry settings must be nonnegative integers.\n' >&2
		exit 1
	fi
done

# Never recursively delete a caller-selected path. Explicit output paths must be new.
if [[ -n "$export_dir" ]]; then
	if [[ "$export_dir" != /* ]] || ! mkdir -- "$export_dir"; then
		printf 'WEB_EXPORT_DIR must be an absolute path to a new directory.\n' >&2
		exit 1
	fi
else
	export_dir="$(mktemp -d /tmp/3plates-web-export.XXXXXXXX)"
fi
# rsync preserves directory permissions; allow the remote web server to traverse it.
chmod 755 -- "$export_dir"
printf 'Building web export in %s\n' "$export_dir"
EXPO_PUBLIC_API_URL="$public_api_url" pnpm --dir apps/mobile exec expo export \
	--platform web \
	--clear \
	--output-dir "$export_dir"

if [[ ! -f "$export_dir/index.html" ]]; then
	printf 'Missing web export index.html in %s\n' "$export_dir" >&2
	exit 1
fi

if ! grep -R -F -q -- "$public_api_url" "$export_dir/_expo/static/js/web"; then
	printf 'Web export does not contain expected API URL: %s\n' "$public_api_url" >&2
	exit 1
fi

control_dir="$(mktemp -d /tmp/3plates-ssh.XXXXXXXX)"
ssh_opts+=(-o "ControlPath=${control_dir}/socket" -o ControlMaster=auto -o ControlPersist=60)
# shellcheck disable=SC2329 # Invoked by the EXIT trap.
cleanup() {
	ssh "${ssh_opts[@]}" -O exit "$deploy_host" >/dev/null 2>&1 || true
	rm -rf -- "$control_dir"
}
trap cleanup EXIT
run_with_timeout_retries "SSH connection" ssh "${ssh_opts[@]}" -MNf "$deploy_host"
ssh "${ssh_opts[@]}" -O check "$deploy_host"

backup_path="$(
	run_with_timeout_retries "Remote backup" \
		ssh "${ssh_opts[@]}" "$deploy_host" \
		"set -e; backup=\"${remote_web_dir}.backup-\$(date +%Y%m%d%H%M%S)\"; cp -a \"${remote_web_dir}\" \"\$backup\"; printf '%s\n' \"\$backup\""
)"
printf 'Created remote backup: %s\n' "$backup_path"

rsync_ssh="ssh -o ConnectTimeout=${ssh_connect_timeout_seconds} -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o BatchMode=yes -o ControlPath=${control_dir}/socket -o ControlMaster=auto -o ControlPersist=60"
run_with_timeout_retries "Web export sync" \
	rsync -az --delete -e "$rsync_ssh" "$export_dir"/ "$deploy_host:$remote_web_dir"/

curl -fsSI --max-time 20 https://3spinningplates.com/progress >/dev/null
curl -fsSI --max-time 20 https://3spinningplates.com/workouts >/dev/null

printf 'Deployed web export to %s:%s\n' "$deploy_host" "$remote_web_dir"
