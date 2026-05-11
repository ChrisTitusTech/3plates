# 3plates Development Todo

Status: Active roadmap
Owner: Core product team
Last updated: 2026-05-09

## Goal

Ship the scaffold into a real cross-platform product with:

- Backend as source of truth for account, progress, and preferences.
- Shared contracts across API and clients.
- Production-safe auth, validation, and CI coverage.

## Priority 1: API to Database Integration

- [x] Connect API routes to the DB package.
- [x] Use entities from [packages/db/src/schema.ts](../packages/db/src/schema.ts) for all saved user state.
- [x] Add per-user lookup and upsert logic for:
	- [x] Progress
	- [x] Preferences
	- [x] Notification devices
- [x] Replace demo responses in API routes with persisted data paths.

Definition of done:

- API reads and writes real records for an authenticated user.
- No route returns hardcoded user data in normal flow.

## Priority 2: Authentication and Account Linking

- [ ] Implement OAuth start and callback for Google.
- [ ] Implement OAuth start and callback for Apple.
- [ ] Persist linked identities in user_identities.
- [ ] Issue and validate sessions consistently.
- [ ] Add auth guard and user context in API request lifecycle.
- [ ] Replace /users/me demo identity with authenticated identity resolution.

Definition of done:

- A single user can sign in from multiple clients and retain one account.
- Session expiry and refresh behavior are explicit and tested.

## Priority 3: Contract and Error Handling Hardening

- [ ] Keep [packages/contract/src/index.ts](../packages/contract/src/index.ts) as the single request and response source.
- [ ] Add typed error responses for:
	- [ ] Invalid or missing auth
	- [ ] Invalid request payload
	- [ ] Missing user state
	- [ ] Conflict or stale update cases
- [ ] Ensure API handlers return only contract-compliant responses.

Definition of done:

- Runtime responses are aligned with contract types in success and failure paths.

## Priority 4: Mobile Wiring

- [ ] Replace scaffold views with real data fetch and mutation flows.
- [ ] Use [apps/mobile/src/lib/api.ts](../apps/mobile/src/lib/api.ts) for route interactions.
- [ ] Add loading and retry states on all stateful screens.
- [ ] Add offline cache support for read paths and pending update handling where needed.

Targets:

- [ ] [apps/mobile/app/sign-in.tsx](../apps/mobile/app/sign-in.tsx)
- [ ] [apps/mobile/app/progress.tsx](../apps/mobile/app/progress.tsx)
- [ ] [apps/mobile/app/preferences.tsx](../apps/mobile/app/preferences.tsx)
- [ ] [apps/mobile/app/notifications.tsx](../apps/mobile/app/notifications.tsx)

Definition of done:

- Mobile screens render backend-backed state and can persist updates.

## Priority 5: Test Expansion

- [x] Add DB-backed integration tests for API routes.
- [ ] Add auth session and guard tests.
- [ ] Add conflict and dedupe behavior tests:
	- [ ] Progress update conflict semantics
	- [ ] Notification device dedupe
- [ ] Keep contract and API tests passing at root.

Definition of done:

- Tests verify behavior, not only response shape.

## Priority 6: CI and Delivery Safety

- [ ] Add CI workflow to run on push and pull request.
- [ ] Run install, test, and typecheck in CI.
- [ ] Add migration checks when DB migrations are introduced.
- [ ] Fail fast on contract drift or type errors.

Definition of done:

- Pull requests cannot merge when core quality gates fail.

## Suggested Execution Order

1. Database-backed API routes
2. OAuth and session lifecycle
3. API auth guard and typed error responses
4. Mobile screen wiring
5. Integration and auth test expansion
6. CI hardening

## Quick Progress Tracker

- [x] P1 API to DB integration
- [ ] P2 Auth and account linking
- [ ] P3 Contract and error hardening
- [ ] P4 Mobile wiring
- [ ] P5 Test expansion
- [ ] P6 CI and delivery safety