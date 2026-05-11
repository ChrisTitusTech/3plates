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
DB_WAIT_TIMEOUT_SECONDS="${DB_WAIT_TIMEOUT_SECONDS:-90}"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Neither 'docker compose' nor 'docker-compose' is available" >&2
  exit 1
fi

attempts=$((DB_WAIT_TIMEOUT_SECONDS))

for ((i = 1; i <= attempts; i++)); do
  if "${COMPOSE_CMD[@]}" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready in ${DB_WAIT_TIMEOUT_SECONDS}s. Inspect logs with: pnpm db:logs" >&2
exit 1