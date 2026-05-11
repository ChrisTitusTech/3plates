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

for _ in {1..30}; do
  if docker-compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready in time. Inspect logs with: pnpm db:logs" >&2
exit 1