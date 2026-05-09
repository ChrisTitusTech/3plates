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
3. Run the API with `pnpm dev:api`.
4. Run the Expo app with `pnpm dev:mobile`.
