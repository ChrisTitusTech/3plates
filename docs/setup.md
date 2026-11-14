---
layout: default
title: Setup
---

# Setup

## Prerequisites

- Node.js 24.
- pnpm 12.18.0 (the version pinned in `package.json`).
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
- `AUTH_REDIRECT_URLS` for additional exact client callback URLs (see below).
- `AUTH_GOOGLE_CLIENT_ID`
- `AUTH_GOOGLE_CLIENT_SECRET`
- `AUTH_APPLE_CLIENT_ID`
- `AUTH_APPLE_TEAM_ID`
- `AUTH_APPLE_KEY_ID`
- `AUTH_APPLE_PRIVATE_KEY` or `AUTH_APPLE_PRIVATE_KEY_PATH` to generate Apple client secrets automatically.
- `AUTH_SESSION_TTL_DAYS`

## OAuth callback allowlist

`AUTH_REDIRECT_URLS` adds comma-separated exact client callback URLs to the server's
built-in allowlist. The production defaults are
`https://3spinningplates.com/auth/callback`,
`https://www.3spinningplates.com/auth/callback`, `threeplates://auth/callback`, and
legacy `threeplates://auth-finished`. Queries, fragments, and embedded credentials
are rejected. This setting controls the client return location; `AUTH_BASE_URL`
controls the API callback URL registered with Google and Apple and does not
implicitly authorize a client redirect.

For another web hostname, add its exact `/auth/callback` URL. For Expo Go, add the
exact callback for the trusted development host, for example
`AUTH_REDIRECT_URLS=exp://192.168.1.10:8081/--/auth/callback`.
Local web callbacks at `http://localhost:8081/auth/callback` and
`http://localhost:3000/auth/callback` are built in only outside production.
Restart the API after changing this environment variable. Do not use wildcards.

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
3. Set **Source** to **GitHub Actions**.
4. Keep `.github/workflows/jekyll-gh-pages.yml` enabled on `main`.
5. The workflow builds Jekyll from `./docs`, uploads `./_site`, and deploys to GitHub Pages.
6. Confirm the latest Pages workflow run succeeds and the docs site loads.

## Publishing rule

- Keep all documentation pages inside the `docs/` folder.
- Update `docs/index.md` when the site structure changes.
- Keep the docs aligned with the actual app scaffold and setup commands.


## Validation dependency compatibility

The shared contract, API and mobile client use Zod 4.6.7 or newer. This includes
[the constrained-collection resource exhaustion fix](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Paginated workout responses cap arrays at the existing 50-item page limit so
oversized pages fail before individual entries are validated.

`@ts-rest/core` is pinned to `3.53.0-rc.1`, the upstream release candidate that
[officially supports Standard Schema and Zod 4](https://github.com/ts-rest/ts-rest/releases).
This is an intentional prerelease dependency: stable 3.52.x requires vulnerable
Zod 3. Before changing the pin, run workspace typechecks and tests, Expo exports
for all platforms, and the dependency audit. No audit finding is suppressed.
