---
layout: default
title: Unified fitness operations and acceptance
---

# Application layout

The Expo app serves web, Android, and iOS from the same Today, Log, Workouts,
Trends, and Account routes. Native charts use react-native-svg. Apple Health and
Health Connect imports remain deferred. The existing workout programs, progress,
preferences, and reminder screens remain accessible.

`apps/whoop` contains Gallant at the revision recorded in `UPSTREAM.md`. Its
standalone dashboard, API, migrations, singleton worker, webhooks, budget controls,
and compatibility tests remain present. Shared analytics run directly in the
client; server credentials and raw database access never enter its bundle.

The main API authenticates a 3plates session, resolves its linked WHOOP subject,
and invokes the WHOOP adapter in-process. The embedded Fastify instance never
listens on a port. Public request headers cannot select a member. A new WHOOP
sign-in proves ownership of the existing Gallant member and preserves that
member's UUID, history, and token encryption key. Email is optional and does not
identify or automatically merge accounts. Existing members should link WHOOP
from Account while signed into their desired 3plates account.

Manual logs use a typed discriminated union, per-user UUIDs and versions. A
mutation and its receipt commit in one transaction. User-row locks serialize
writes across API processes. Deletions retain versioned tombstones. The device
persists its records and outgoing mutations together; a lost response retries the
same mutation UUID. Conflicting edits remain on the device until the user
explicitly chooses the server version. Manual/WHOOP workout associations keep
measurements separate while avoiding duplicate activity counts.

Health caches and queues are scoped by user ID. A queued write checks that its
captured session actually belongs to that user. Sign-out refuses pending health
changes unless the user explicitly discards them. Removing a sign-in method
refuses the sole remaining login and revokes existing sessions. Removing WHOOP
also deletes its imported history. Stopping WHOOP sync instead retains history
and the login method, disables sharing, and revokes data access. WHOOP sign-in
can reconnect that access.

Account deletion first persists a marker and revokes sessions. A cleanup pass
runs at API startup and every minute, deleting WHOOP data before the local user
and cascading manual logs/receipts. Provider/storage outages retain the marker
for retry. Keep at least one API process running to perform this cleanup.

# Local development and verification

Use Node 24 and the repository's pinned pnpm 12.18.0. Copy `.env.example` to
`.env`, configure development authentication, and run:

```bash
pnpm install --frozen-lockfile
pnpm db:setup
pnpm dev
pnpm typecheck
pnpm test
pnpm --filter @3plates/api build
pnpm --filter @3plates/mobile exec expo install --check
pnpm --filter @3plates/mobile exec expo export --platform all --output-dir dist
pnpm --filter @3plates/mobile exec playwright install chromium
pnpm --filter @3plates/mobile test:browser
pnpm --filter @3plates/whoop check
```

The API database tests use the local Compose database and truncate its fixture
tables. Never run them with a production `DATABASE_URL`. WHOOP integration tests
require an isolated database named `gallant_test`; their environment explicitly
ignores the namespaced production WHOOP settings:

```bash
docker run -d --name gallant-test-db \
  -e POSTGRES_USER=gallant_test -e POSTGRES_PASSWORD=local-test-only \
  -e POSTGRES_DB=gallant_test -p 127.0.0.1:55433:5432 postgres:16-alpine
pnpm --filter @3plates/whoop test:db
pnpm --filter @3plates/whoop exec playwright install chromium
pnpm --filter @3plates/whoop test:browser
```

If that test container already exists, start it instead of creating another.
Browser suites use synthetic data; they do not establish live WHOOP acceptance.

The existing native build scripts and CI compile the generated Android and iOS
projects. A JavaScript export is a separate gate from native compilation and
real-device testing. On Linux, iOS compilation needs the macOS CI runner or a Mac.
Do not treat unsigned simulator builds as signed app-store artifacts.

## Local acceptance evidence (2026-11-14)

The implementation through `8bd8b6f` has the following passing local evidence.
Unchanged contract, API, and compatibility suites retain their earlier passing
results; affected client tests, exports, and native compilation were rerun after
the final units and offline sign-out fixes.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm typecheck` | Passed; mobile typecheck repeated after the final client fix |
| `pnpm test` | Contract 6, API 54, client 30; no skips |
| `pnpm --filter @3plates/whoop check` | Typecheck, lint, 23 unit tests, and production build passed |
| `pnpm --filter @3plates/whoop test:db` | 17 passed against the isolated fixture database |
| `pnpm --filter @3plates/whoop test:browser` | 26 desktop/phone tests passed |
| `pnpm --filter @3plates/mobile test:browser` | 22 desktop/phone tests passed |
| `pnpm --filter @3plates/mobile exec expo export --platform all --output-dir dist` | Web, Android, iOS exports passed |
| `pnpm --filter @3plates/mobile exec expo install --check` | Dependencies current for SDK 58 |
| `pnpm --filter @3plates/api build` | Passed; built API health/shutdown verified with WHOOP enabled and disabled |
| `pnpm db:generate` | No migration drift |
| Android `:app:assembleRelease` | ARM64 and x86_64 passed with local debug signing |
| Independent Codex review | Full integration reviewed against `main`; all findings fixed; follow-up of `8bd8b6f` found no actionable regressions |

The Android build used JDK 17 and the installed Android SDK with this command
from `apps/mobile/android`:

```bash
JAVA_HOME=/home/titus/.cache/3plates-toolchain/java/jdk-17.0.21+9 \
ANDROID_HOME=/home/titus/.cache/3plates-toolchain/sdk \
./gradlew :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon
```

This produces an APK at
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`; it is a local
validation artifact, not a signed store release. No real-device testing or iOS
native compilation was performed on this Linux workstation. There is no PR for
this integration, so remote CI and PR review/thread state are not applicable.

# Server configuration and rollout

The user authorized VPS deployment on 2026-11-14. The web/API release is now
deployed as described below. Native app-store publication remains a separate
release action. The following procedure records the rollout and its remaining
WHOOP configuration step.

1. Back up both the 3plates and existing Gallant databases and verify a restore.
   Preserve the current Gallant encryption key and protected environment file.
2. Register the 3plates callback (`AUTH_BASE_URL` + `/auth/callback`) with WHOOP,
   alongside the legacy `/callback`. Allow the web and native client
   callbacks through `AUTH_REDIRECT_URLS` as documented in `.env.example`.
   Verify WHOOP member-tier approval before expanding beyond the app's member
   limit. Google and Apple require their own configured credentials/callbacks.
3. Configure **server-only** `WHOOP_DATABASE_URL`, `WHOOP_CLIENT_ID`,
   `WHOOP_CLIENT_SECRET`, and `WHOOP_TOKEN_KEY` together. Use the existing Gallant
   values so the API adopts its data instead of creating a second history.
   `WHOOP_PUBLIC_URL` is the legacy public dashboard origin used for sharing.
   Omitting all four disables WHOOP; partial configuration fails startup.
4. Apply the 3plates migration with `pnpm db:migrate`, build with
   `pnpm --filter @3plates/api build`, and run the existing API service using
   `node apps/api/dist/main.js`. Use the existing protected API environment.
   Do not copy secrets into the repository or mobile environment.
5. Initially keep the existing standalone Gallant web service and worker on their
   current release. They provide the webhook endpoint, public share pages, and
   ingestion jobs for the same database. Do not start another worker: the
   advisory lock protects against this, but duplicate services are an error.
   The imported `apps/whoop/deploy` scripts describe Gallant's **standalone**
   release layout; do not run `activate.sh` against the monorepo root. Moving
   those services to this workspace is a separate release-layout change.
6. Verify API health, each provider's sign-in/link flow, existing-member history,
   manual entry CRUD, sync/backfill status, private exports, selective expiring
   public shares, disconnect/reconnect, and deletion retry. Compare WHOOP values
   and coverage against the existing dashboard for the same member and dates.
7. Validate the deployed web/API release with explicit health and route checks.
   Signed native publication still requires the device/provider gates below.
   Apply the repository's VPS instructions: one SSH connection and one remote
   command at a time, long command timeout, and explicit health checks. VPS
   commands were used only for the subsequently authorized deployment.

Rollback must retain the new identity semantics: the old application can merge
accounts by email and cannot represent the new logs/deletion markers. Disable the
new entry points and WHOOP adapter while repairing a release, or restore both
verified pre-release database backups with the corresponding application version
in a maintenance window. Do not simply reintroduce the old unique-email constraint
once accounts with matching emails exist. Keep the legacy Gallant worker/key and
backups intact throughout.

## VPS deployment evidence (2026-11-14 America/Chicago)

- Deployed application revision `636b8c7` to
  `/opt/3plates/releases/636b8c7`, switched `/opt/3plates/current`, and published
  the production web export to `/var/www/3plates`. Existing hashed web assets
  were retained for already-open clients; the HTML was replaced last.
- Connected through `ssh 3plates`. Multiplexing was refused, so commands used a
  single persistent shell. That shell was closed before the sequential SCP
  transfer, then reopened. No concurrent SSH commands or transfers were used.
- Verified source and web archive SHA-256 checksums. Built the API on the VPS
  using Node 24 and the pinned pnpm 12.18.0 without changing the global pnpm.
- Backed up both databases, protected environment files, previous release path,
  and website under `/var/backups/3plates/deploy-636b8c7`. Both database dumps
  restored successfully into temporary databases. Gallant had one member and
  1,381 records at verification time. An additional 3plates dump was taken with
  the API stopped immediately before production migration.
- Applied migrations to the restored database first. A temporary candidate API
  passed authenticated log CRUD, mutation replay, conflict, export, and deletion
  checks using a synthetic account in that database. The candidate also read
  the existing WHOOP profile/dashboard through the integration. The temporary
  service, account, and database were removed afterward.
- Applied the production migration and restarted the API successfully. API,
  Gallant web, and Gallant worker services remain active and enabled. The legacy
  Gallant release, worker, database, and encryption key were retained.
- External HTTP checks passed for the website, all five app routes, API health,
  Gallant dashboard, and `forum.christitus.com`. Unauthenticated manual-log
  access returns 401. Public HTML matches the new release. API activation logs
  contain no warnings or errors.

**WHOOP callback resolved:** after the user updated the provider configuration,
`https://api.3spinningplates.com/auth/callback` was accepted. The authorization
endpoint now returns 302 through WHOOP's auth-service login to `id.whoop.com`,
instead of its invalid-redirect error page. The identity login page rejects
non-browser fetches with 403, so this verifies the authorization redirect, not
a completed user consent or token exchange.

The active API environment was backed up before merging the five staged WHOOP
settings, preserving all other current configuration. Environment files remain
mode 600. After restarting `3plates-api`, the public `/auth/providers` endpoint
lists Google, Apple, and WHOOP. A live `/auth/start` request with the web callback
successfully reaches WHOOP's identity login. Website, API, Gallant, and forum
checks pass; API activation logs contain no warnings or errors. The SSH session
was closed after the sequential checks.

# Appearance release

The appearance follow-up (`2af5ed5`, `256003f`, `2f6653e`) adds Light, Dark, and
Follow system controls, shared native/web palettes, themed charts and settings,
and the corresponding status bar/browser color scheme. It uses the existing
account preference, hydrates cached appearance before network requests, and
retries pending preferences every 30 seconds while the app is active, including
native reconnects without foreground events. Session switches clear the old
appearance before validating the new account.

Local checks for this follow-up pass: mobile typecheck, 32 client tests, 32
desktop/phone browser tests, all three Expo exports, and Android ARM64/x86_64
native compilation. Light/dark phone screenshots were inspected. Independent
review findings about cached hydration, native reconnect retries, and account
switches were fixed; the focused follow-up review of `2f6653e` found no
actionable regressions.

The user subsequently authorized VPS deployment. Web revision `3a7de87` is
deployed to `/var/www/3plates`; the unchanged API remains at `636b8c7` with WHOOP
enabled. A fresh production export was built with the production API URL and
transferred through `3plates` using strictly sequential SSH/SCP connections.
The previous website is backed up at `/var/backups/3plates/deploy-3a7de87/web`.
Archive checksum verification passed before activation. Assets were copied
first and HTML replaced last, retaining older hashed assets for open clients.

The public HTML and all 18 web JavaScript files match the local release bytes.
All five app routes, API health, Gallant, and the forum pass HTTP checks; Google,
Apple, and WHOOP remain available. No API restart, database migration, or
environment change was needed. The SSH connection was closed after deployment.

# Release acceptance still requiring external evidence

- Signed Android and iOS builds on actual target devices, including accessibility,
  keyboard handling, reminders, file exports, browser-to-app OAuth return, and
  foreground/background transitions.
- Google, Apple, and WHOOP sign-in/link/reconnect using real provider consent,
  registered callbacks, and approved WHOOP membership capacity.
- Offline writes followed by restart, reconnect, cross-device conflict, account
  switching, and deletion on real devices. Confirm pending edits are preserved.
- Live WHOOP history/count/score comparison, webhook delivery and replay, recent
  sync/full backfill, token rotation, and no duplicate worker.
- Verified backups, restore drill, publication authorization, and post-release
  website/API/forum/worker checks over a serial VPS connection.

# PR #44 cache and operations hardening

Profile caches now carry a SHA-256 binding to their session token; the raw native
credential remains in secure storage. An older cache without that binding needs
one successful online profile load before offline account access is available.
Legacy edits are migrated under the previous profile owner. If that profile is
malformed, unidentified legacy edits are retained under the `user/unverified`
cache namespace for recovery instead of being assigned to a new account.

The reviewed WHOOP activation script checks both web and worker artifacts, stops
the old worker, removes its heartbeat, and then requires readiness from the new
worker. Restart/readiness failures enter the existing sharing-policy-safe rollback.
Monitoring bounds database and alert-hook calls within its service deadline and
records delivery status only after the hook succeeds. These review changes are
not yet deployed to the VPS; the previously recorded live release is unchanged.
