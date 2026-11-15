# 3plates

Fitness app for web, Android, and iOS, sharing an Expo client and a central API.

## Documentation

The GitHub Pages docs live in [docs/](docs/).
See the [unified fitness implementation](docs/unified-fitness-plan.md) and
[configuration, verification, and rollout guide](docs/unified-fitness-operations.md)
for WHOOP integration and offline manual logging.

## Layout

- `apps/mobile` - Expo app for iOS, Android, and web.
- `apps/api` - Fastify API for auth, user state, and sync.
- `apps/whoop` - Gallant compatibility dashboard, WHOOP ingestion, and shared analytics.
- `packages/contract` - ts-rest contracts for shared request and response types.
- `packages/db` - Drizzle schema and database helpers.

## Stack

- Contract-first API with ts-rest.
- Postgres + Drizzle for persistence.
- Google, Apple, and optional WHOOP OAuth with explicit account linking, server-managed sessions, and secure native token storage.
- Offline manual workouts, nutrition, hydration, sleep, recovery journals, body weight, and goals.
- Light, dark, and system appearance across fitness screens, charts, and settings.
- Expo Notifications for the first push path.

Use the Appearance controls on any fitness screen to choose Light, Dark, or
Follow system. Choices use the existing account preference, persist offline,
and synchronize when connectivity returns. Settings uses the same saved theme.

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

## Validation and releases

Use the Node version in `.node-version` and the pnpm version in `package.json`.
Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm test` before publishing changes.
The API tests require Docker Compose and start the local test database.

CI checks types, tests, migration drift (including new migration files), shell scripts,
Expo dependency compatibility, and production JavaScript exports for web, Android,
and iOS. Separate CI jobs compile an Android release with local debug signing and
an unsigned iOS simulator release. These builds do not exercise real devices or
produce store-signed releases.

Before shipping, build and test the native apps on their target platforms. Verify
Google, Apple, and WHOOP sign-in/linking, sign-out, session expiry, workout persistence, offline
recovery, notifications, and accessibility on web, Android, and iOS. iOS native
builds require macOS/Xcode or an authenticated EAS build environment; store builds
also require signing credentials. Existing EAS preview profiles are for internal
validation, not store submission.

`pnpm deploy:web` exports and deploys the website to the configured SSH host.
Deployment is a separate release action; passing CI does not deploy the app.
Exports use a new temporary directory; an explicit `WEB_EXPORT_DIR` must be an
absolute path that does not already exist. The script preserves exports for inspection
and reuses a verified SSH connection for backup and synchronization.
Keep SDK dependency changes coordinated with Expo's supported React and React
Native versions rather than independently upgrading every package to its latest major.
