---
layout: default
title: VPS And Website Tasks
---

# VPS And Website Tasks

Status: Active task list
Owner: Core product team
Last updated: 2026-07-06

## Goal

Finish the remaining VPS setup, website validation, and documentation publishing work for the 3plates web experience.

## Tasks

- [x] Update `scripts/db-smoke-test.sh` so the persisted API round trip uses the current bearer-auth flow instead of legacy `x-user-*` headers.
- [x] Keep GitHub CI running the database smoke test against a live API and Postgres.
- [x] Use [VPS Setup Checklist](vps-setup-checklist.md) as the canonical database setup runbook.
- [x] Validate VPS recreation with production-like `.env` values, Postgres bound to `127.0.0.1`, migrations applied, and API connectivity confirmed.
- [ ] Verify GitHub Pages publishes the documentation from the `/docs` folder on `main`.
- [ ] Run Expo web manual acceptance for login, account linking, streak updates, workout mode selection, workout list rendering, web push registration, refresh, expiry, and sign-out.
- [ ] Validate web accessibility and responsive behavior, including keyboard navigation, semantic labels, and mobile/desktop breakpoints.

## Latest local validation

- 2026-07-06: `pnpm install --frozen-lockfile` passed.
- 2026-07-06: `pnpm --filter @3plates/contract test` passed.
- 2026-07-06: `pnpm typecheck` passed.
- 2026-07-06: `pnpm --filter @3plates/db generate` reported no schema changes.
- 2026-07-06: `git diff --exit-code -- packages/db/drizzle` passed.
- 2026-07-06: `pnpm test` passed.
- 2026-07-06: CI-style API startup plus `pnpm db:test` passed against a live local API and Postgres container.
- 2026-07-06: `bash -n`, `shellcheck`, and `shfmt -d` passed for `scripts/db-smoke-test.sh`.
- 2026-07-06: VPS `auth` rebuild validation passed on `/root/3plates` with Node 24, pnpm 9.15.4, Docker Compose, generated `.env` values, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, a live API plus `pnpm db:test`, healthy loopback-only Postgres on `127.0.0.1:5432`, and UFW not exposing Postgres.
- 2026-07-06: Public DNS resolvers returned `64.52.108.248` for `3spinningplates.com` and `api.3spinningplates.com`; the local resolver still had the previous address cached during validation.

## Acceptance

- `pnpm db:test` reflects the current authentication model.
- CI runs `pnpm db:test` with a live API process before a push is considered green.
- VPS setup has a single checklist with prerequisites, environment variables, database commands, smoke-test validation, and network/security checks.
- The VPS can be rebuilt from documented setup steps without exposing Postgres publicly.
- The web experience passes the manual account, state, notification, accessibility, and responsive checks.
- Published docs point to current requirements, setup, and task lists only.
