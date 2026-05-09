---
layout: default
title: Requirements
---

# Product Requirements

## Core product rules

- The website, Android app, and iOS app must behave as one product.
- The backend is the source of truth for progress, preferences, and account state.
- Client-side storage is limited to cache, offline support, and transient UI state.
- Shared domain models and validation rules should be reused across platforms.

## Authentication requirements

- OAuth with Google and Apple is required.
- Account linking must be supported so one person can keep one identity across all clients.
- Provider subject IDs plus verified email should be used for identity resolution.
- Session handling must be consistent across web, Android, and iOS.

## Data requirements

- Progress, settings, and preferences must be persisted in a central database.
- The data model must support incremental updates from any client.
- Conflicts and sync metadata should be supported where needed.
- Server-side validation must protect any saved user state.

## Notifications requirements

- The backend should be prepared for push notification delivery from day one.
- Device token registration should be represented in the data model early.
- Expo Notifications can be used first, but the backend should not block future provider changes.
