---
layout: default
title: VPS Setup Checklist
---

# VPS Setup Checklist

Use this checklist to rebuild the current 3plates VPS database and API validation path from a clean server.

## Server prerequisites

- A Linux VPS with SSH access.
- Git.
- Node.js 24.
- pnpm 9.15.4.
- Docker with the Compose plugin, or `docker-compose`.
- `curl`.

## Repository setup

1. Clone the repository onto the VPS.
2. Check out the branch or commit you intend to run.
3. Run `pnpm install --frozen-lockfile`.
4. Copy `.env.example` to `.env`.
5. Fill in `.env` with VPS values.

Required `.env` values for the database and API validation path:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_PORT`
- `DATABASE_URL`
- `API_PORT`
- `API_HOST`
- `AUTH_SECRET`
- `AUTH_BASE_URL`
- `AUTH_GOOGLE_CLIENT_ID`
- `AUTH_GOOGLE_CLIENT_SECRET`
- `AUTH_APPLE_CLIENT_ID`
- `AUTH_APPLE_CLIENT_SECRET`
- `AUTH_SESSION_TTL_DAYS`
- `ADMIN_API_KEY`

Keep `.env` out of git.

## Database setup

1. Confirm `docker-compose.yml` publishes Postgres only on `127.0.0.1:${POSTGRES_PORT}`.
2. Confirm `DATABASE_URL` uses `localhost` or `127.0.0.1` with the same port.
3. Start Postgres and apply migrations:

```bash
pnpm db:setup
```

4. Confirm the container is healthy:

```bash
docker compose ps postgres || docker-compose ps postgres
```

5. If setup fails, inspect database logs:

```bash
pnpm db:logs
```

## API validation

Run the API in one shell:

```bash
pnpm dev:api
```

Run the database smoke test in another shell:

```bash
pnpm db:test
```

The smoke test must pass these checks:

- Docker is reachable.
- Postgres starts and accepts connections.
- Drizzle migrations apply cleanly.
- Required tables exist.
- The API health endpoint responds.
- A real bearer session authenticates `/users/me`.
- Progress updates persist and read back through the API.
- Preferences updates persist and read back through the API.
- Notification device registration writes through the API.
- Unauthenticated state requests return `401`.
- Sign-out revokes the bearer session.

## Network and security checks

1. Confirm Postgres is not listening publicly:

```bash
ss -tulpn | grep 5432
```

The expected bind address is `127.0.0.1:${POSTGRES_PORT}`, not `0.0.0.0:${POSTGRES_PORT}`.

2. Confirm the API binds to loopback when it is running behind the VPS web proxy:

```bash
API_HOST=127.0.0.1
```

3. Confirm the API health route from the VPS:

```bash
curl -fsS "http://127.0.0.1:${API_PORT}/health"
```

4. Confirm the public firewall does not expose Postgres or the API port.
5. Confirm SSH access still works before ending the maintenance session.

## Ready criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm db:test` passes with the API running.
- Postgres is bound to loopback only.
- The repository docs publish from `docs/` on `main`.
