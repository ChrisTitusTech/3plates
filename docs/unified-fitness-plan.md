---
layout: default
title: Unified fitness implementation
---

# Approved scope

One 3plates account on web, Android, and iOS; Google, Apple, and WHOOP sign-in. WHOOP is optional. Existing Gallant members retain history after proving ownership. Never merge accounts by matching email alone. Keep the WHOOP database, encryption key, raw records, request budgets, singleton worker, sharing policies, and legacy dashboard compatible.

Manual logs: workouts with sets/reps/weight, nutrition/macros, hydration, sleep, recovery journals, body weight and goals. Typed validation, CRUD, idempotent offline writes, versions, deletion markers, user-scoped caches, timezone and source attribution. Manual records never overwrite WHOOP measurements or silently double-count a linked workout.

Native apps first; Apple Health and Health Connect are deferred. Native charts must use native components, not embed the dashboard in a WebView.

# Implementation gates

- [x] Import Gallant server, worker, analytics, compatibility web UI, and tests; validate unchanged behavior.
- [x] WHOOP sign-in and linking; tenant-scoped access, reconnect/disconnect, exports/sharing, deletion, prevent removal of sole login.
- [x] Structured manual logs and durable offline CRUD, retries, conflicts, and per-user isolation.
- [x] Today, Log, Workouts, Trends, Account experiences across web and native.
- [x] Automated unit/database/browser tests, production exports, Android native compilation.
- [x] Independent review of the completed integration, with clean follow-up on fixes.
- [ ] iOS native compilation on macOS.
- [ ] Real-device Google/Apple/WHOOP login and linking, offline recovery, cross-device sync, reminders and accessibility.
- [ ] Live WHOOP history comparison and webhook verification, release backup/rollback and serial VPS health checks.

# Release constraints

Implementation and the subsequent VPS deployment are authorized. Application
revision `636b8c7` is deployed to the VPS with verified backups and migration.
WHOOP sign-in is enabled after callback registration and a successful live
authorization redirect check; the legacy Gallant dashboard and worker remain
operational. Native publication,
actual devices, WHOOP member tier, and live consent remain external acceptance
gates; report missing evidence rather than marking them complete. Test data must
be synthetic; preserve all unrelated changes.

# Baseline

3plates: 7d36cd8. Gallant: 9367c25. Native CI passes for baseline, but historical device checklist is incomplete. Existing manual workout writes require network connectivity. WHOOP has a separate cookie-based identity and database. This document tracks implementation; checked gates require actual evidence.

# Implementation evidence

2026-11-14: imported compatibility module passes 23 unit tests, 17 database tests,
and 26 desktop/mobile browser tests. Main workspace passes 90 contract/API/client
tests, including identity isolation, sole-login protection, deletion retry, SQL
concurrency/idempotency, offline restart/lost response/conflict handling, and
workout association. Typechecking and API build pass. Expo production exports
for web, Android, and iOS pass; these are not native compilation/device evidence.
The unified browser suite passes twenty-two desktop/phone tests. Android release compilation with local debug
signing passes (ARM64 and x86_64). Production API health and graceful shutdown pass with
WHOOP enabled and disabled. Migration generation reports no drift. iOS native
compilation requires a Mac. Independent review and the follow-up of its fixes
are complete. See [operations and acceptance](unified-fitness-operations.md)
for configuration, rollout, rollback, and remaining external gates.

Review pass one identified legacy cache migration, stale open-form versions, and
Today WHOOP refresh defects. All were reproduced/fixed and covered by regression
tests. Session transitions also clear mounted forms, and workout linking can load
WHOOP records for historical dates. Follow-up review verified these fixes.

Review pass two identified WHOOP outage handling in Account and same-range
workout reloads. Both are fixed and covered on desktop and phone layouts. A
synthetic OAuth/database test also verifies existing Gallant member/history
adoption. Temporary API failures now preserve cached account access and offline
logging; browser tests also verify synchronization after recovery and sign-out
during an outage.

The final full review identified delayed preferences changing an open form's
units and a missing confirmed discard action during an Account outage. Both are
fixed with desktop/phone regressions: editing waits for units, temporary failures
retain cached preferences, and offline sign-out requires explicit confirmation
before discarding pending edits. The focused independent Codex review of
`8bd8b6f` found no actionable regressions. The current automated suites total
178 passing tests. An earlier nested review attempt was interrupted and is not
counted as passing evidence; the subsequent direct reviews completed.

2026-11-15 PR #44 review hardening: fixed oversized workout uploads, goal unit
conversion, refresh pool exhaustion, and deletion pagination. The subsequent
review batch protects account-scoped confirmations and profile caches, serializes
preference retries, preserves queued edits during failures/cleanup, makes auth
session rotation atomic with unlinking, and protects refreshed WHOOP credentials
from late failures. Worker lock loss now terminates the worker; deployment and
monitoring scripts exercise rollback, new-worker readiness, and alert retry paths.
Smaller fixes cover UTC/DST interpretation, rolling averages, consistent history
snapshots, weight-chart date spacing, bounded demo ranges, and sign-in retries.

Local validation: 6 contract, 61 API, 43 mobile, 25 WHOOP unit, 23 WHOOP database,
38 unified browser, 26 legacy dashboard browser, 7 WHOOP operations, and 5 web
deployment tests pass. Workspace typechecks, WHOOP lint/build, API build, shell
checks, and web/Android/iOS exports pass. The first independent review found a
malformed-profile recovery regression; its fix preserves unidentified offline
edits separately and has dedicated regression coverage. The focused follow-up
review completed with no actionable findings. Remote checks and reviews
must pass on the published head before merge. Real-device acceptance remains the
next stage under the user's requested sequence.

A further review pass identified overlapping account loads, save completion
clearing a newer draft, and queue writes that could resolve a different account
between their read and write. Loads now use sequence guards, saves preserve
newer draft revisions, and queue operations retain their captured storage key.
Sleep edits preserve seconds/fractions, WHOOP reconciliation uses the database
clock, integration tests pin the validated database before dotenv loading, and
invalid dashboard ranges cancel their loading state. Browser log fixtures are
account-scoped and assert saved entries do not cross accounts.

Updated validation: 45 mobile, 25 WHOOP unit, 25 WHOOP database, 44 unified
browser, and 30 legacy dashboard browser tests pass. Workspace typechecks,
WHOOP lint/build, and web/Android/iOS exports pass; earlier passing checks remain
applicable to unchanged API, contract, and operations code. Independent review
found that preserving typing during an existing-entry save also needed to
advance that draft's expected version. The fix has desktop/phone coverage that
successfully saves the preserved draft again without hiding external conflicts.
The scoped independent follow-up completed with no actionable findings. Exact
remote-head checks and review completion are still required before merge.

The next review batch serializes memory identity removal across provider
cleanup and removes all account-owned memory during deletion. Account sharing
forms reset to fresh defaults when no policy exists, and sign-out retains its
original owner/session through discard, cleanup, and backend completion. Local
session transitions serialize cache removal with a later sign-in. Notes-only
recovery edits retain tags containing commas. Offsite uploads have I/O and
whole-command deadlines and record success only after completion. The legacy
Gallant deletion UI explicitly limits its scope to WHOOP data; full 3plates
account deletion remains in the fitness app's Account screen. Stale WHOOP
authorization failures preserve new credentials and defer backfill jobs without
exhausting their retry budget.

Validation for this batch: 6 contract, 63 API, 48 mobile, 25 WHOOP unit,
25 WHOOP database, 46 unified browser, 32 legacy browser, and 8 WHOOP operations
tests pass; the 5 unchanged web deployment tests retain their prior evidence
(258 total). Workspace typechecks, API and WHOOP builds, WHOOP lint, shell
syntax/ShellCheck/shfmt, and web/Android/iOS exports pass. Independent Codex
review of the batch completed with no actionable regressions. CI and remote
reviews must still complete on the published commit before merge.


The latest review batch versions account authentication. Unlinking cancels pending
OAuth links and invalidates callbacks that already resolved an identity; session
creation and rotation validate that version while holding the same account lock.
The additive 0009 migration is documented in the operations guide. Memory and
PostgreSQL regressions cover pending links, consumed callbacks, late session
creation, and fresh sign-in through the remaining provider.

WHOOP refreshes on focus, foreground, and every 30 seconds while focused. Training
and Trends expose initial account failures with retry instead of empty history.
Chart summaries are accessibility elements. Session expiry removes credentials
while preserving account-owned queued progress/preferences; reauthentication can
replay them, and a delayed expiry cannot sign out a newer session. Explicit
sign-out/discard keeps its existing cleanup behavior.


Validation for this batch: `pnpm test` passes 6 contract, 69 API (including
PostgreSQL), and 49 mobile tests without skips. All 52 unified desktop/phone
browser tests pass. Together with the unchanged WHOOP unit/database/legacy
browser/operations and web-deployment evidence, this is 271 tests. Workspace
typechecks, API build, production web/Android/iOS exports, migration generation
(no drift), and the migrated database/API smoke test pass. The smoke test was
rerun after starting the local API; the browser suite was rerun against a stable
export after an overlapping export caused 404s and an error-message assertion
was corrected. Real-device VoiceOver/TalkBack acceptance remains a release gate.

The independent Codex review of this batch completed with no actionable
regressions; its targeted tests and typechecks also passed. `pnpm audit` reports
no known vulnerabilities. CI and remote review must pass on the published head
before merge; the production database and deployed applications are unchanged.


The next review batch binds file exports to their initiating owner and session,
including native sharing setup. Refresh replacement validates the original token
inside the serialized transition. Notes-only measurement edits preserve exact
canonical values, including maximum hydration and workout set weights. Fitness
pages include all safe-area insets. Legacy sharing writes carry their draft's
member ID and choose public tokens under a row lock; oversized demo ranges show
a recoverable error. Database integration tests build required static assets.
Backup commands and the service have finite deadlines and lock waits.

Additional Codex findings are covered in this batch: WHOOP credential exchange
has no member/import side effects until 3plates accepts the identity; activation
holds the account lock and rejects removed identities or deletion tombstones.
Full reconciliation retires covered webhook failures while retaining newer and
other-account failures. Regression tests cover these cases in the API memory
and PostgreSQL stores and the WHOOP database.


Validation: 6 contract, 71 API, 51 mobile, 25 WHOOP unit, 28 WHOOP database,
58 unified browser, 34 legacy browser, and 10 operations tests pass with no
skips. The 5 unchanged web-deployment tests retain prior evidence (288 total).
Workspace and WHOOP typechecks, WHOOP lint/build, API build, all-platform Expo
exports, Bash syntax/ShellCheck/shfmt, and the dependency audit pass (no known
vulnerabilities). The legacy browser suite was rerun successfully after correcting
the new test's persisted-date URL encoding and an interrupted mobile navigation
check during a development-server source update. Local systemd verification
requires substitutions for the absent production path and Docker service;
installed-service and real-device safe-area/share-sheet checks remain rollout
acceptance work. No VPS changes were made in this review cycle.

Independent Codex review of the completed batch found no actionable regressions;
its focused API/mobile/operations checks also pass. Remote CI and review remain
required on the next published head before merge.

The latest review fixes preserve structured log drafts through credential expiry
and restore them only after loading the same account. Browser drafts survive the
OAuth redirect in session storage; native drafts last for the current process.
Cancel/discard and explicit sign-out clear drafts. Legacy screens now observe
session changes, and workouts ignore stale request completions.

Account queue writes, migrations, cleanup, and flushes share a per-account lock
(with Web Locks across browser tabs). A flush checkpoints each acknowledged
mutation before attempting the next one. Health-log retryable failures retain
the exact mutation ID and block only later edits of the same record; independent
records still upload. Shared health validation rejects null characters before
JSONB writes. Shared WHOOP reads recheck tokens, connection state, expiry, and
policy inside the history snapshot. Empty namespaced WHOOP configuration falls
back to valid standalone settings.

Validation: 7 contract, 71 API, 54 mobile, 25 WHOOP unit, 30 WHOOP database,
64 unified desktop/phone browser, and 34 legacy browser tests pass with no skips.
The unchanged 10 operations and 5 web-deployment tests retain prior evidence
(300 total). Workspace/WHOOP typechecks, WHOOP lint/build, API build, all-platform
Expo exports, and the dependency audit pass. Regression tests cover simultaneous
offline queue writes, a successful upload followed by 401, independent-record
retry, draft recovery/isolation/cleanup, cross-tab sign-out, and sharing changes
between token lookup and history reads. Native process termination intentionally
does not preserve unsaved transient forms; saved offline entries remain durable.
Real-device acceptance and VPS rollout remain the next phase after merge.

Independent Codex review completed with no actionable regressions in this batch,
including the new draft store. Its repeated 54 mobile and 7 contract tests,
mobile typecheck, and whitespace checks passed. Remote CI and reviews still need
to complete on the published head before merge.
