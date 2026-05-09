# Copilot Instructions

## Product Context

This app has three client surfaces: a website, an Android app, and an iOS app. All three clients must behave as one product, share the same account model, and read and write user progress and preferences through a central backend.

## Core Architecture Rules

- Treat the backend as the source of truth for user progress, preferences, and account state.
- Keep client-side storage limited to cache, offline support, and transient UI state.
- Prefer shared domain models, shared API contracts, and shared validation rules across platforms.
- When adding features, think in terms of backend API, data model, and client rendering together.
- Avoid duplicating business logic in multiple clients when it can live in a shared service or common module.

## Authentication And Accounts

- Use OAuth with Google and Apple as the primary login methods.
- Support account linking so the same person can keep one identity across web, Android, and iOS.
- Prefer provider subject IDs plus verified email as the identity basis, not display names.
- Handle sign-in, sign-out, refresh, and session expiry consistently across all clients.
- Keep authentication flows secure and minimal, and do not invent custom credential storage when OAuth is available.

## Data And Sync

- Persist user progress, settings, and preferences in a central database.
- Design schemas so progress can be updated incrementally and safely from any client.
- Include timestamps, versioning or conflict metadata where needed for sync and reconciliation.
- When a data change affects progress or preferences, update the API contract, database schema, and client state together.
- Prefer explicit server-side validation for anything that changes saved user state.

## Platform Guidance

- Website: optimize for responsive behavior, accessibility, and fast initial load.
- Android: follow platform conventions for navigation, permissions, and lifecycle handling.
- iOS: follow platform conventions for navigation, permissions, and lifecycle handling.
- Keep the visual language consistent across platforms, but allow platform-native interaction patterns.
- Share copy, product terminology, and state names across all clients whenever possible.

## Implementation Preferences

- Prefer small, testable modules over large coupled components.
- Favor explicit types, named data structures, and clear function boundaries.
- Reuse existing libraries and patterns already present in the repository before introducing new ones.
- Make schema, API, and auth changes backward compatible when practical.
- Ask before making destructive data migrations or breaking API changes.

## Quality Bar

- Add or update tests for auth, sync, and data persistence changes.
- Verify changes against the relevant platform behavior, not just one client.
- Check edge cases for offline use, duplicate sign-ins, stale sessions, and conflicting updates.
- Do not leave TODOs for core account, progress, or preference handling unless explicitly requested.

## Security And Privacy

- Minimize the amount of personal data stored beyond what is needed for account and sync features.
- Store tokens and secrets only in approved secure storage mechanisms.
- Never log access tokens, refresh tokens, or sensitive user data.
- Treat Google and Apple identity data as sensitive and handle it with least privilege.

## When In Doubt

- Prefer the simplest design that preserves a single source of truth.
- If a request could be implemented in more than one place, choose the backend or shared layer first.
- If requirements conflict, prioritize correctness of saved user state and account continuity over client convenience.
