---
layout: default
title: Website Implementation Spec
---

# Website Implementation Spec

Status: Active roadmap
Owner: Core product team
Last updated: 2026-05-13

## Goal

Ship the website experience on Expo web with the same account and state model used by Android and iOS:

- OAuth login with one cross-platform account identity.
- First-login user bootstrap with level assignment.
- Daily login streak tracking.
- Workout-of-the-day options from a database, filtered by user mode choice.

## Scope

Included:

- Web flow in [apps/mobile](../apps/mobile/) using Expo web.
- Backend-authoritative state updates through [apps/api](../apps/api/).
- Shared API contracts in [packages/contract/src/index.ts](../packages/contract/src/index.ts).
- Shared persistence and migrations in [packages/db/src/schema.ts](../packages/db/src/schema.ts).

Excluded:

- Separate website codebase in apps/web.
- Client-only business rules for level, streak, or workout selection.

## Product Rules

- Backend remains source of truth for progress, preferences, and account state.
- Clients can cache and queue writes, but do not own state conflict resolution.
- Login behavior must be consistent across web, Android, and iOS.
- Any saved user data change must be represented in contract, API, and DB.
- Admin-only write operations must be explicitly authorized and audited.
- Public user reads must never expose unpublished workout content.

## Delivery Phases

## Foundation Baseline (Inherited From Scaffold Todo)

Source: [docs/scaffold-todo.md](scaffold-todo.md)

- [x] API is database-backed for authenticated user state reads/writes.
- [x] OAuth providers, account linking, and auth guard lifecycle are implemented.
- [x] Contract-first API validation and typed error responses are in place.
- [x] Mobile data wiring, offline queue behavior, and CI test gates are in place.
- [x] Workout read foundation exists: catalog table, mode-filtered read endpoint, and tests.

Definition of done:

- Website phases only track net-new work and parity completion, not already-finished scaffold tasks.

## Phase 0: Spec Lock And Interface Plan

Depends on: completed scaffold work in [docs/scaffold-todo.md](scaffold-todo.md)

- [x] Capture web scope and non-goals for Expo web surface.
- [x] Finalize streak timezone rule: user profile timezone is authoritative, with UTC fallback when timezone is missing.
- [x] Finalize workout list ordering policy: admin priority first, then newest published, then createdAt as deterministic tie-breaker.
- [x] Finalize API error contract additions for workout category validation: invalid_request_payload for invalid mode values and missing required query fields.

Phase 0 decision record:

- Timezone policy: streak day boundaries use persisted user timezone when present.
- Workout list policy: API returns deterministic admin-prioritized ordering.
- Error policy: contract-level payload validation handles mode/category query errors with typed 400 responses.

Definition of done:

- A single approved behavior spec exists for login, level assignment, streak, and workout options.

## Phase 1: Login, First-Login Bootstrap, And Level Assignment

Depends on: Phase 0

- [x] Keep backend login/session OAuth flow foundation used by mobile via [apps/api/src/auth-service.ts](../apps/api/src/auth-service.ts).
- [x] Implement Expo web UI flow on top of the existing backend OAuth/session model.
- [x] Keep backend account linking foundation so one person can keep one cross-platform identity.
- [x] Add web account-linking UX parity with existing linked-identity backend behavior.
- [x] On first successful login, assign user level 1 server-side and persist it.
- [x] Expose first-login signal in auth/session response so clients can drive onboarding UI.
- [x] Keep backend refresh and session-expiry semantics aligned for shared clients.
- [x] Implement web refresh-token and session-expiry handling parity in client UX.
- [x] Implement explicit sign-out behavior parity in web UX.
- [x] Ensure returning logins preserve level and never re-run bootstrap.

Definition of done:

- New users are created once, assigned level 1 once, and return the same account identity across all clients.

## Phase 2: Daily Login Streak Engine

Depends on: Phase 1

- [ ] Add server-side streak update on authenticated login completion.
- [ ] Increment streak at most once per user per local day.
- [ ] Reset streak after missed-day boundary based on selected timezone policy.
- [ ] Persist last streak update metadata for idempotency and replay safety.

Definition of done:

- Repeated same-day logins from web/mobile do not double-increment streak, and missed-day behavior is deterministic.

## Phase 3: Workout Options By User Choice

Depends on: Phase 1 (parallel with Phase 2)

- [x] Add a workout mode selection step in UI: active recovery or strength metcon.
- [x] Add workout catalog storage in DB with category tagging and active/published state.
- [x] Add API endpoint to fetch workouts by selected mode from database.
- [ ] Add explicit pagination and ordering contract for workout list reads.
- [x] Return a list payload suitable for web and mobile rendering.
- [x] Add empty-state handling when no workouts exist for selected mode.

Definition of done:

- User selects one mode and receives a database-backed list of matching workouts.

## Phase 4: Admin Growth Path For Workout Catalog

Depends on: Phase 3

- [ ] Define admin write path for adding new workouts over time.
- [ ] Define admin authorization model and enforce it at API layer for all workout write endpoints.
- [ ] Support safe publish/unpublish without breaking client reads.
- [ ] Add audit fields (createdAt, updatedAt, publishedAt, createdBy where available).
- [ ] Add optimistic concurrency rule for admin updates (version or precondition check).
- [ ] Add contract-validated admin payload schema for workout entries.

Definition of done:

- Admins can continuously add workouts and users immediately see newly published entries in filtered lists.
- Unauthorized users cannot create, edit, publish, or unpublish workouts.

## Phase 5: Expo Web UI And Cross-Platform Parity

Depends on: Phases 2-4

- [ ] Build website screens in [apps/mobile/app](../apps/mobile/app/) with web-compatible layout behavior.
- [ ] Add login, streak, mode selection, and workout list screens/states.
- [ ] Reuse shared API client patterns from [apps/mobile/src/lib/api.ts](../apps/mobile/src/lib/api.ts).
- [ ] Add web notification token registration path aligned to existing notification device model.
- [ ] Keep language and state names identical across web, Android, and iOS.

Definition of done:

- Web and native clients show functionally equivalent account, streak, and workout-option behavior backed by the same APIs.

## Phase 6: Quality, Testing, And Rollout

Depends on: all prior phases

- [ ] Add contract tests for new workout and streak fields in [packages/contract/src/index.test.ts](../packages/contract/src/index.test.ts).
- [ ] Add DB-backed API integration tests for first-login level assignment and streak idempotency in [apps/api/src/server.db.test.ts](../apps/api/src/server.db.test.ts).
- [x] Add API tests for workout mode filtering.
- [ ] Add API tests for admin publish behavior.
- [ ] Add API tests for admin authorization and optimistic concurrency conflict behavior.
- [ ] Validate web behavior manually in Expo web plus regression checks on iOS/Android clients.
- [ ] Validate web accessibility and responsive behavior (keyboard navigation, semantic labels, mobile breakpoints).

Definition of done:

- CI passes typecheck and tests for contract, API, and mobile with no drift between platforms.

## Data And API Spec Notes (Implementation Targets)

Minimum data additions:

- User progress/account state:
	- level (default 1 on first login).
	- streakDays (existing, now server-driven at login).
	- lastLoginAt and lastStreakAwardedDate (or equivalent for idempotency).
	- timezone (if using per-user local-day policy).
- Workout catalog:
	- id, title, description.
	- mode enum: active_recovery | strength_metcon.
	- difficulty or level compatibility.
	- isPublished, createdAt, updatedAt, publishedAt.
	- version (or equivalent) for optimistic concurrency controls.
	- createdBy for admin audit attribution where available.

Migration and backfill expectations:

- Add DB migration for all new user and workout fields before enabling new API paths.
- Backfill existing users with level 1 and deterministic default timezone policy.
- Keep rollout backward compatible until all three clients consume new fields.

Minimum API additions:

- Auth/session response includes first-login signal and effective level.
- Streak update runs as part of successful login server flow.
- Workout list endpoint accepts mode and returns matching published workouts.
- Workout list endpoint supports explicit ordering and pagination metadata.
- Admin workout write endpoints for create/update/publish.
- Admin workout write endpoints enforce role checks and return typed authorization failures.
- Admin workout update endpoints enforce optimistic concurrency with typed conflict errors.

Minimum auth/session parity additions:

- Account linking flow is available and consistent on web, Android, and iOS.
- Refresh, expiry, and sign-out semantics are consistent across all clients.

## Acceptance Checklist

- [ ] First login creates user and assigns level 1 exactly once.
- [ ] Daily streak increases once per day regardless of login client.
- [ ] User can choose active recovery or strength metcon mode.
- [ ] Workout list comes from DB based on selected mode.
- [ ] Newly published admin workouts appear in user lists without client updates.
- [ ] Admin permissions are enforced for workout writes and covered by tests.
- [ ] Workout list pagination and ordering are deterministic and documented.
- [ ] Account linking, refresh, expiry, and sign-out behavior match across all clients.
- [ ] Web push token registration uses same backend model as mobile clients.
- [ ] Web accessibility and responsive acceptance checks pass.
- [ ] Web, Android, and iOS behavior matches for login, streak, and workout options.

## Suggested Execution Order

1. Confirm inherited scaffold baseline and lock unresolved Phase 0 policies.
2. Implement Phase 1 net-new backend behavior (first-login level and session response fields), then web auth UX parity.
3. Implement Phase 2 streak engine (server-side idempotent updates and timezone policy).
4. Complete Phase 3 remaining items (pagination/ordering contract and web mode-selection UX).
5. Implement Phase 4 admin write path with authorization and optimistic concurrency.
6. Implement Phase 5 web notification parity and remaining web UX parity.
7. Complete Phase 6 tests for all new behaviors, then run final cross-platform parity validation.
