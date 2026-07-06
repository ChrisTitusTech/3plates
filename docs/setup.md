---
layout: default
title: Setup
---

# Setup

## Prerequisites

- Node.js 24.
- pnpm 9 or newer.
- A local Postgres database.
- Expo tooling for mobile development.

## Environment variables

Copy `.env.example` to `.env` and fill in the values for:

- `DATABASE_URL`
- `API_PORT`
- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` for browser push subscriptions, when web push is enabled.
- `AUTH_SECRET`
- `AUTH_BASE_URL`
- `AUTH_GOOGLE_CLIENT_ID`
- `AUTH_GOOGLE_CLIENT_SECRET`
- `AUTH_APPLE_CLIENT_ID`
- `AUTH_APPLE_CLIENT_SECRET`
- `AUTH_SESSION_TTL_DAYS`

## Local development

1. Install dependencies with `pnpm install`.
2. Start Postgres and apply migrations with `pnpm db:setup`.
3. Start the backend with `pnpm dev:api`.
4. Start the Expo app with `pnpm dev:mobile`.
5. Open the app in web, Android, or iOS as needed.

## Database setup

1. The repo ships with `docker-compose.yml` for a local Postgres 16 instance.
2. The container binds to `127.0.0.1:${POSTGRES_PORT}` so it is not exposed beyond the host.
3. The Drizzle migrations in `packages/db/drizzle/` create both the schema and the `pgcrypto` prerequisite for UUID generation.
4. Generate new migration SQL with `pnpm db:generate` after changing `packages/db/src/schema.ts`.
5. Apply migrations with `pnpm db:migrate`.
6. `pnpm db:setup` combines container startup and migration application for normal local use.
7. Use `pnpm db:reset` to recreate the database volume and replay migrations from scratch.
8. Use `pnpm db:test` after the API is running to validate container health, migration state, and a persisted API round-trip.

## VPS recreation

Use [VPS Setup Checklist](vps-setup-checklist.md) for a full rebuild and validation pass.

The database rule is fixed for the current scaffold: keep Postgres bound to `127.0.0.1` and keep `DATABASE_URL` pointed at `localhost` when the API runs on the VPS host. If the API later moves into Docker on the same compose network, remove the published Postgres port and connect to the `postgres` service name instead.

Track remaining VPS and website validation work in [VPS And Website Tasks](vps-website-tasks.md).

## GitHub Pages setup

1. In the GitHub repository, open **Settings**.
2. Open **Pages**.
3. Set **Source** to deploy from a branch.
4. Select branch `main` and folder `/docs`.
5. Save the settings and wait for GitHub Pages to publish the docs site.

## Publishing rule

- Keep all documentation pages inside the `docs/` folder.
- Update `docs/index.md` when the site structure changes.
- Keep the docs aligned with the actual app scaffold and setup commands.
