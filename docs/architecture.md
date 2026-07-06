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
packages/
  contract/      ts-rest route definitions and shared request/response types
  db/            Drizzle schema, migrations, and database helpers
```

## Recommended stack

- Expo for the client app surface.
- Fastify for the backend API.
- ts-rest for contract-first type sharing.
- Postgres with Drizzle for persistence.
- Better Auth or Clerk for authentication.
- Expo Notifications for the initial push path.

## Why this shape

- The client apps stay aligned because the backend owns state.
- The contract layer prevents hand-written request/response drift.
- The database package keeps schema and migrations close together.
- Notifications can evolve later without reorganizing the project.
