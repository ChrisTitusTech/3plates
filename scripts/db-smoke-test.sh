#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if [[ -f .env ]]; then
	set -a
	# shellcheck disable=SC1091
	source .env
	set +a
elif [[ -f .env.example ]]; then
	set -a
	# shellcheck disable=SC1091
	source .env.example
	set +a
else
	printf 'Missing .env or .env.example in %s\n' "$repo_root" >&2
	exit 1
fi

POSTGRES_DB="${POSTGRES_DB:-3plates}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
API_PORT="${API_PORT:-3000}"
api_base_url="http://127.0.0.1:${API_PORT}"
smoke_email="${SMOKE_TEST_EMAIL:-smoke-test@example.com}"
smoke_display_name="${SMOKE_TEST_DISPLAY_NAME:-Smoke Test}"

required_tables=(
	users
	user_identities
	auth_sessions
	oauth_transactions
	mobile_auth_exchanges
	user_progress
	user_preferences
	notification_devices
	progress_events
	workouts
)

compose() {
	if docker compose version >/dev/null 2>&1; then
		docker compose "$@"
		return
	fi

	if command -v docker-compose >/dev/null 2>&1; then
		docker-compose "$@"
		return
	fi

	printf 'Docker Compose is required. Install the Docker Compose plugin or docker-compose.\n' >&2
	exit 1
}

postgres_exec() {
	compose exec -T postgres "$@"
}

psql_command() {
	postgres_exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

require_command() {
	local command_name="$1"

	if ! command -v "$command_name" >/dev/null 2>&1; then
		printf 'Required command not found: %s\n' "$command_name" >&2
		exit 1
	fi
}

build_session_token() {
	node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
}

hash_session_token() {
	local token="$1"

	TOKEN="$token" node <<'NODE'
const { createHash } = require('node:crypto');
const token = process.env.TOKEN;

if (!token) {
  process.exit(1);
}

process.stdout.write(createHash('sha256').update(token).digest('hex'));
NODE
}

one_hour_from_now() {
	node -e 'console.log(new Date(Date.now() + 60 * 60 * 1000).toISOString())'
}

assert_payload_equals() {
	local actual="$1"
	local expected="$2"
	local label="$3"

	if [[ "$actual" != "$expected" ]]; then
		printf 'Unexpected %s payload returned by API:\n%s\n' "$label" "$actual" >&2
		exit 1
	fi
}

assert_json_field_equals() {
	local payload="$1"
	local field="$2"
	local expected="$3"
	local label="$4"

	PAYLOAD="$payload" FIELD="$field" EXPECTED="$expected" node <<'NODE'
const payload = JSON.parse(process.env.PAYLOAD ?? '{}');
const field = process.env.FIELD;
const expected = process.env.EXPECTED;

if (!field || payload[field] !== expected) {
  process.exit(1);
}
NODE
	local status=$?

	if [[ "$status" -ne 0 ]]; then
		printf 'Unexpected %s payload returned by API:\n%s\n' "$label" "$payload" >&2
		exit 1
	fi
}

require_command docker
require_command curl
require_command node

echo "==> Ensuring Docker is available"
docker info >/dev/null

echo "==> Ensuring Postgres container is running"
compose up -d postgres >/dev/null

echo "==> Checking Postgres readiness"
if ! postgres_exec pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null; then
	echo "Postgres is not ready yet. Inspect logs with: pnpm db:logs" >&2
	exit 1
fi

echo "==> Applying Drizzle migrations"
pnpm --filter @3plates/db migrate >/dev/null

echo "==> Verifying migrated schema"
tables_output="$(psql_command -Atqc "select tablename from pg_tables where schemaname = 'public' order by tablename")"

for table_name in "${required_tables[@]}"; do
	if ! grep -qx "$table_name" <<<"$tables_output"; then
		echo "Expected table '$table_name' was not found in Postgres." >&2
		exit 1
	fi
done

echo "==> Checking API availability at $api_base_url"
if ! curl -fsS "$api_base_url/health" >/dev/null; then
	echo "API is not reachable at $api_base_url. Start it with: pnpm dev:api" >&2
	exit 1
fi

echo "==> Creating a temporary bearer-auth smoke session"
smoke_token="$(build_session_token)"
smoke_token_hash="$(hash_session_token "$smoke_token")"
session_expires_at="$(one_hour_from_now)"

psql_command \
	-v ON_ERROR_STOP=1 \
	-v smoke_email="$smoke_email" \
	-v smoke_display_name="$smoke_display_name" \
	-v smoke_token_hash="$smoke_token_hash" \
	-v session_expires_at="$session_expires_at" <<'SQL' >/dev/null
WITH smoke_user AS (
  INSERT INTO users (email, display_name, updated_at)
  VALUES (:'smoke_email', :'smoke_display_name', now())
  ON CONFLICT (email) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        updated_at = now()
  RETURNING id
),
revoked_existing_sessions AS (
  UPDATE auth_sessions
  SET revoked_at = now()
  WHERE user_id = (SELECT id FROM smoke_user)
    AND revoked_at IS NULL
)
INSERT INTO auth_sessions (user_id, token_hash, expires_at)
SELECT id, :'smoke_token_hash', :'session_expires_at'::timestamptz
FROM smoke_user
ON CONFLICT (token_hash) DO UPDATE
  SET expires_at = EXCLUDED.expires_at,
      revoked_at = NULL;
SQL

auth_header=(-H "authorization: Bearer ${smoke_token}")

echo "==> Verifying bearer session authentication"
me_payload="$(curl -fsS "${auth_header[@]}" "$api_base_url/users/me")"
assert_json_field_equals "$me_payload" "email" "$smoke_email" "user"

echo "==> Exercising a persisted progress write/read round-trip"
curl -fsS -X PUT \
	-H 'content-type: application/json' \
	"${auth_header[@]}" \
	"$api_base_url/users/me/progress" \
	-d '{"streakDays":7,"completedWorkouts":14,"lastWorkoutAt":"2026-05-11T03:03:00.000Z"}' >/dev/null

progress_payload="$(curl -fsS \
	"${auth_header[@]}" \
	"$api_base_url/users/me/progress")"

expected_payload='{"streakDays":7,"completedWorkouts":14,"lastWorkoutAt":"2026-05-11T03:03:00.000Z"}'
assert_payload_equals "$progress_payload" "$expected_payload" "progress"

echo "==> Exercising a persisted preferences write/read round-trip"
curl -fsS -X PUT \
	-H 'content-type: application/json' \
	"${auth_header[@]}" \
	"$api_base_url/users/me/preferences" \
	-d '{"theme":"dark","units":"imperial","reminderTime":"06:45","timezone":"America/Chicago"}' >/dev/null

preferences_payload="$(curl -fsS \
	"${auth_header[@]}" \
	"$api_base_url/users/me/preferences")"

expected_preferences_payload='{"theme":"dark","units":"imperial","reminderTime":"06:45","timezone":"America/Chicago"}'
assert_payload_equals "$preferences_payload" "$expected_preferences_payload" "preferences"

echo "==> Exercising notification device registration"
curl -fsS -X POST \
	-H 'content-type: application/json' \
	"${auth_header[@]}" \
	"$api_base_url/notifications/devices" \
	-d '{"platform":"web","pushToken":"smoke-web-push-token"}' >/dev/null

echo "==> Verifying unauthenticated requests are rejected"
unauthenticated_status="$(curl -sS -o /dev/null -w '%{http_code}' "$api_base_url/users/me/progress")"
if [[ "$unauthenticated_status" != "401" ]]; then
	printf 'Expected unauthenticated progress read to return 401, got %s.\n' "$unauthenticated_status" >&2
	exit 1
fi

echo "==> Verifying sign-out revokes the bearer session"
sign_out_payload="$(curl -fsS -X POST \
	-H 'content-type: application/json' \
	"${auth_header[@]}" \
	"$api_base_url/auth/sign-out" \
	-d '{}')"

assert_payload_equals "$sign_out_payload" '{"signedOut":true}' "sign-out"

revoked_status="$(curl -sS -o /dev/null -w '%{http_code}' "${auth_header[@]}" "$api_base_url/users/me")"
if [[ "$revoked_status" != "401" ]]; then
	printf 'Expected revoked bearer session to return 401, got %s.\n' "$revoked_status" >&2
	exit 1
fi

echo "Smoke test passed: Postgres is running, Drizzle migrations are applied, bearer auth works, and API persistence works."
