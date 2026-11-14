---
layout: default
title: Unified fitness implementation
---

# Approved scope

One 3plates account on web, Android, and iOS; Google, Apple, and WHOOP sign-in. WHOOP is optional. Existing Gallant members retain history after proving ownership. Never merge accounts by matching email alone. Keep the WHOOP database, encryption key, raw records, request budgets, singleton worker, sharing policies, and legacy dashboard compatible.

Manual logs: workouts with sets/reps/weight, nutrition/macros, hydration, sleep, recovery journals, body weight and goals. Typed validation, CRUD, idempotent offline writes, versions, deletion markers, user-scoped caches, timezone and source attribution. Manual records never overwrite WHOOP measurements or silently double-count a linked workout.

Native apps first; Apple Health and Health Connect are deferred. Native charts must use native components, not embed the dashboard in a WebView.

# Implementation gates

- [ ] Import Gallant server, worker, analytics, compatibility web UI, and tests; validate unchanged behavior.
- [ ] WHOOP sign-in and linking; tenant-scoped access, reconnect/disconnect, exports/sharing, deletion, prevent removal of sole login.
- [ ] Structured manual logs and durable offline CRUD, retries, conflicts, and per-user isolation.
- [ ] Today, Log, Workouts, Trends, Account experiences across web and native.
- [ ] Automated unit/database/browser tests, production exports, native builds, independent review.
- [ ] Real-device Google/Apple/WHOOP login and linking, offline recovery, cross-device sync, reminders and accessibility.
- [ ] Live WHOOP history comparison and webhook verification, release backup/rollback and serial VPS health checks.

# Release constraints

Implementation is authorized. Publishing/deploying this integration requires explicit authorization; previous maintenance/PR authorization does not implicitly publish this new feature. No production migration or credential changes during development. Signing credentials, actual devices, WHOOP callback registration/member tier, and live consent are external acceptance gates; report missing evidence rather than marking them complete. Test data must be synthetic; preserve all unrelated changes.

# Baseline

3plates: 7d36cd8. Gallant: 9367c25. Native CI passes for baseline, but historical device checklist is incomplete. Existing manual workout writes require network connectivity. WHOOP has a separate cookie-based identity and database. This document tracks implementation; checked gates require actual evidence.
