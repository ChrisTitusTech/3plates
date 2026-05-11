#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
elif [[ -f .env.example ]]; then
  set -a
  source .env.example
  set +a
else
  echo "Missing .env or .env.example in $repo_root" >&2
  exit 1
fi

POSTGRES_DB="${POSTGRES_DB:-3plates}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
API_PORT="${API_PORT:-3000}"
api_base_url="http://127.0.0.1:${API_PORT}"

required_tables=(
  users
  user_identities
  user_progress
  user_preferences
  notification_devices
  progress_events
)

echo "==> Ensuring Docker is available"
docker info >/dev/null

echo "==> Ensuring Postgres container is running"
docker-compose up -d postgres >/dev/null

echo "==> Checking Postgres readiness"
if ! docker-compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null; then
  echo "Postgres is not ready yet. Inspect logs with: pnpm db:logs" >&2
  exit 1
fi

echo "==> Applying Drizzle migrations"
pnpm --filter @3plates/db migrate >/dev/null

echo "==> Verifying migrated schema"
tables_output="$(docker-compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select tablename from pg_tables where schemaname = 'public' order by tablename")"

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

echo "==> Exercising a persisted progress write/read round-trip"
curl -fsS -X PUT \
  -H 'content-type: application/json' \
  -H 'x-user-email: smoke-test@example.com' \
  -H 'x-user-display-name: Smoke Test' \
  "$api_base_url/users/me/progress" \
  -d '{"streakDays":7,"completedWorkouts":14,"lastWorkoutAt":"2026-05-11T03:03:00.000Z"}' >/dev/null

progress_payload="$(curl -fsS \
  -H 'x-user-email: smoke-test@example.com' \
  -H 'x-user-display-name: Smoke Test' \
  "$api_base_url/users/me/progress")"

expected_payload='{"streakDays":7,"completedWorkouts":14,"lastWorkoutAt":"2026-05-11T03:03:00.000Z"}'

if [[ "$progress_payload" != "$expected_payload" ]]; then
  echo "Unexpected progress payload returned by API:" >&2
  echo "$progress_payload" >&2
  exit 1
fi

echo "Smoke test passed: Postgres is running, Drizzle migrations are applied, and API persistence works."