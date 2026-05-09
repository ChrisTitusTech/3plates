---
layout: default
title: Setup
---

# Setup

## Prerequisites

- Node.js 20 or newer.
- pnpm 9 or newer.
- A local Postgres database.
- Expo tooling for mobile development.

## Environment variables

Copy `.env.example` to `.env` and fill in the values for:

- `DATABASE_URL`
- `API_PORT`
- `EXPO_PUBLIC_API_URL`
- `AUTH_SECRET`
- `AUTH_GOOGLE_CLIENT_ID`
- `AUTH_GOOGLE_CLIENT_SECRET`
- `AUTH_APPLE_CLIENT_ID`
- `AUTH_APPLE_CLIENT_SECRET`

## Local development

1. Install dependencies with `pnpm install`.
2. Start the backend with `pnpm dev:api`.
3. Start the Expo app with `pnpm dev:mobile`.
4. Open the app in web, Android, or iOS as needed.

## Database setup

1. Create a local Postgres database.
2. Point `DATABASE_URL` at that database.
3. Use the Drizzle package for schema generation and migrations.
4. Keep schema changes in `packages/db/src/schema.ts`.

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
