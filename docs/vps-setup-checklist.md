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

## VPS operating constraints

- Treat the VPS as slow and capacity-constrained.
- Run only one remote command or SSH session at a time against the VPS.
- Allow at least 5 minutes for a remote task to finish before treating it as timed out.
- For SSH or `rsync` connection timeouts, wait 30 seconds and retry the same operation. Make no more than 2 retry attempts after the original timeout.
- Before killing a remote task, first verify with `ps aux` that the target process is not using CPU.
- Do not start a replacement deployment, restart, or validation command while a prior remote task is still running.

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
- `AUTH_APPLE_TEAM_ID`
- `AUTH_APPLE_KEY_ID`
- `AUTH_APPLE_PRIVATE_KEY` or `AUTH_APPLE_PRIVATE_KEY_PATH`
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

## Public web proxy

The VPS uses Caddy as the public HTTP/S front door. Keep Caddy on public
`80` and `443`, and keep backend services on loopback-only ports.

Current production routing:

- `forum.christitus.com` -> Discourse on `127.0.0.1:8443`.
- `3spinningplates.com` -> static Expo web export in `/var/www/3plates`.
- `api.3spinningplates.com` -> Fastify API on `127.0.0.1:3000`.

Current backend bind rules:

- Discourse exposes `127.0.0.1:8080:80` and `127.0.0.1:8443:443`.
- The 3plates API uses `API_HOST=127.0.0.1`.
- Postgres remains on `127.0.0.1:${POSTGRES_PORT}`.

Validate the public routes after any proxy or deployment change:

```bash
curl -I https://forum.christitus.com
curl -I https://3spinningplates.com
curl -fsS https://api.3spinningplates.com/health
```

Validate the expected listener layout on the VPS:

```bash
ss -tulpn | grep -E ':(80|443|3000|8080|8443)\b'
```

## Web deployment

Deploy the static Expo web build with:

```bash
pnpm deploy:web
```

The deploy command builds a clean production web export with
`EXPO_PUBLIC_API_URL=https://api.3spinningplates.com`, creates a timestamped
backup of `/var/www/3plates`, syncs the export to the VPS, and validates the
public Progress and Workouts routes. If an SSH or `rsync` connection times out,
it waits 30 seconds and retries the same operation up to 2 times before failing.

## Ready criteria

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm db:test` passes with the API running.
- Postgres is bound to loopback only.
- The repository docs publish from `docs/` on `main`.
