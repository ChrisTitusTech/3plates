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

Implementation is authorized. Publishing/deploying this integration requires explicit authorization; previous maintenance/PR authorization does not implicitly publish this new feature. No production migration or credential changes during development. Signing credentials, actual devices, WHOOP callback registration/member tier, and live consent are external acceptance gates; report missing evidence rather than marking them complete. Test data must be synthetic; preserve all unrelated changes.

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
