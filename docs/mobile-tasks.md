---
layout: default
title: Mobile Tasks
---

# Mobile Tasks

Status: Active task list
Owner: Core product team
Last updated: 2026-07-06

## Goal

Finish the remaining iOS and Android validation work so the native clients match the web experience for account and state behavior.

## Tasks

- [ ] Run iOS regression checks for login, account linking, streak updates, workout mode selection, workout list rendering, refresh, expiry, and sign-out.
- [ ] Run Android regression checks for login, account linking, streak updates, workout mode selection, workout list rendering, refresh, expiry, and sign-out.
- [ ] Verify native notification permission prompts and token registration on iOS and Android.
- [ ] Confirm cached reads continue working after network failure on both native platforms.
- [ ] Confirm queued progress, preference, and notification writes flush successfully after connectivity returns.
- [ ] Confirm OAuth callback and deep-link behavior works on both native platforms.

## Acceptance

- iOS and Android match the web account, streak, workout, session, and sign-out behavior.
- Native notification registration stores valid device records through the shared backend model.
- Offline reads and queued writes recover without losing user state.
