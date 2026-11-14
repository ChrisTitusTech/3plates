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

# Server configuration and rollout

Publishing and deployment of this integration have not been authorized. The
following is the prepared rollout procedure, to perform only after that approval
and completion of the acceptance gates.

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
7. Publish web and signed native artifacts only after the checks below pass.
   Apply the repository's VPS instructions: one SSH connection and one remote
   command at a time, long command timeout, and explicit health checks. No VPS
   commands were required for this implementation.

Rollback must retain the new identity semantics: the old application can merge
accounts by email and cannot represent the new logs/deletion markers. Disable the
new entry points and WHOOP adapter while repairing a release, or restore both
verified pre-release database backups with the corresponding application version
in a maintenance window. Do not simply reintroduce the old unique-email constraint
once accounts with matching emails exist. Keep the legacy Gallant worker/key and
backups intact throughout.

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
