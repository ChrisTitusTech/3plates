---
layout: default
title: Architecture
---

# Architecture

## Repository layout

```text
apps/
  mobile/        Expo app for iOS, Android, and web
  api/           Fastify backend
  whoop/         Gallant compatibility dashboard, worker, and shared analytics
packages/
  contract/      ts-rest route definitions and shared request/response types
  db/            Drizzle schema, migrations, and database helpers
```

## Recommended stack

- Expo for the client app surface.
- Fastify for the backend API.
- ts-rest for contract-first type sharing.
- Postgres with Drizzle for persistence.
- Server-managed OAuth sessions with Google, Apple, and WHOOP adapters; explicit identity linking.
- Expo Notifications for the initial push path.

## Why this shape

- The client apps stay aligned because the backend owns state.
- The contract layer prevents hand-written request/response drift.
- The database package keeps schema and migrations close together.
- Notifications can evolve later without reorganizing the project.

The main API owns 3plates authentication and manual logs. It resolves the linked
WHOOP subject server-side and accesses the existing Gallant database through an
in-process adapter. The standalone Gallant worker retains its singleton lock,
request budgets, and history, and the existing web service continues to receive
webhooks and serve public shares. See the [integration operations guide](unified-fitness-operations.md).
