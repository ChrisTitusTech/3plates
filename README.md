# 3plates

Monorepo scaffold for a multi-platform fitness app.

## Documentation

The GitHub Pages docs live in [docs/](docs/).

## Layout

- `apps/mobile` - Expo app for iOS, Android, and web.
- `apps/api` - Fastify API for auth, user state, and sync.
- `packages/contract` - ts-rest contracts for shared request and response types.
- `packages/db` - Drizzle schema and database helpers.

## Stack direction

- Contract-first API with ts-rest.
- Postgres + Drizzle for persistence.
- Better Auth or Clerk for authentication.
- Expo Notifications for the first push path.

## Local development

1. Copy `.env.example` to `.env` and fill in real values.
2. Install dependencies with `pnpm install`.
3. Start and migrate local Postgres with `pnpm db:setup`.
4. Run the API with `pnpm dev:api`.
5. Run the Expo app with `pnpm dev:mobile`.

## Local Postgres

- `docker-compose.yml` starts Postgres 16 and binds it to `127.0.0.1` only, so it is reachable from the local machine but not exposed publicly.
- The Drizzle migration chain in `packages/db/drizzle/` is now fully self-contained, including the `pgcrypto` prerequisite used by UUID defaults.
- `pnpm db:migrate` applies the generated Drizzle SQL from `packages/db/drizzle/`.
- `pnpm db:setup` is the normal local workflow: start Postgres and apply migrations.
- Use `pnpm db:reset` when you need a clean database volume and a fresh migration replay.
- Use `pnpm db:logs` to inspect startup and healthcheck output.
- Use `pnpm db:test` to verify Docker, Postgres schema, and an API-backed persisted write/read round-trip.
