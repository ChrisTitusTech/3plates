---
layout: default
title: Mobile Tasks
---

# Mobile Tasks

Status: Active phased plan
Owner: Core product team
Last updated: 2026-07-08

## Goal

Finish native mobile validation with Android first, then iOS, so both native
clients match the production web experience for authentication, account state,
workout history, progress, notifications, offline reads, and queued writes.

## Working Rules

- Keep Android as the primary path until an installable APK has passed physical-device smoke testing.
- Keep iOS work blocked behind the Android APK gate unless an iOS-only blocker is discovered while editing shared code.
- Commit after each major phase only after that phase's automated tests and manual acceptance checks pass.
- Keep commits scoped to the phase being tested. Do not mix unrelated UI cleanup, deployment scripts, or local machine setup changes into mobile commits.
- Update this document after each phase with the test evidence, commit hash, date, device or simulator used, and any follow-up defects.

## Baseline Commands

Run from the repository root unless noted otherwise.

```sh
pnpm install --frozen-lockfile
pnpm --filter @3plates/contract typecheck
pnpm --filter @3plates/mobile typecheck
pnpm --filter @3plates/mobile test
pnpm --filter @3plates/api typecheck
pnpm --filter @3plates/api test
```

Use the repo's pinned runtime requirements: Node 24 and pnpm 9.15.4.

## Phase 0 - Mobile Build Inventory

Purpose: make the native build path explicit before Android implementation starts.

Tasks:

- [ ] Confirm final mobile identifiers:
  - Android application id.
  - iOS bundle identifier.
  - App display name.
  - Custom URL scheme for OAuth and deep links.
- [ ] Confirm native API targets:
  - Local development API URL for emulator and physical Android devices.
  - Production API URL.
  - Any staging API URL, if one exists.
- [ ] Confirm OAuth redirect URLs needed by Google and Apple for native auth exchange.
- [ ] Confirm Expo account, EAS project, and project id requirements for native push tokens.
- [ ] Record available test devices:
  - Physical Android phone model, Android version, and CPU architecture.
  - Android emulator image, API level, and Play Services availability.
  - Physical iPhone model and iOS version, if available.
  - iOS simulator version, if available.

Automated gate:

- [ ] `pnpm --filter @3plates/mobile typecheck`
- [ ] `pnpm --filter @3plates/mobile test`

Commit gate:

- [ ] Commit documentation and configuration decisions after the automated gate passes.

## Phase 1 - Android Build Foundation

Purpose: create a repeatable Android APK build that can be installed on a
physical device.

Tasks:

- [ ] Add committed Expo app configuration if still missing (`app.json` or `app.config.ts`).
- [ ] Configure Android package id, app name, icons, splash assets, permissions, deep-link scheme, and notification metadata.
- [ ] Add `eas.json` profiles for at least:
  - Android internal APK testing.
  - Android production or preview build.
  - iOS placeholder profile for the later iOS phase.
- [ ] Decide whether the first Android APK is built with local EAS, cloud EAS, or a generated native Android project.
- [ ] Document any required local Android tooling: JDK, Android SDK, `adb`, environment variables, and signing credentials.
- [ ] Ensure `EXPO_PUBLIC_API_URL` is injected for Android builds instead of relying on `localhost`.
- [ ] Verify the notification registration path can read an EAS project id at runtime.

Automated gate:

- [ ] `pnpm --filter @3plates/mobile typecheck`
- [ ] `pnpm --filter @3plates/mobile test`
- [ ] Android APK build completes from a clean checkout using the documented profile.

Manual Android gate:

- [ ] APK installs on a physical Android device.
- [ ] App launches without a white screen or native crash.
- [ ] App can reach the configured API from the physical device.
- [ ] App shows the sign-in screen when no session exists.

Commit gate:

- [ ] Commit Android build configuration and docs after the APK installs and launches.

## Phase 2 - Android Auth, Session, and Deep Links

Purpose: verify the account lifecycle on Android before checking product state.

Tasks:

- [ ] Test Google sign-in from Android, including browser handoff and return to the app.
- [ ] Test Apple sign-in path if it is exposed on Android.
- [ ] Test account linking for each supported provider.
- [ ] Test expired bearer-token handling and session refresh.
- [ ] Test sign-out clears SecureStore or AsyncStorage session data and returns to sign-in.
- [ ] Test OAuth callback and deep-link handling from cold start and foreground state.
- [ ] Add or update automated tests for any native-specific auth/deep-link behavior that can be isolated without a device.

Automated gate:

- [ ] `pnpm --filter @3plates/contract typecheck`
- [ ] `pnpm --filter @3plates/mobile typecheck`
- [ ] `pnpm --filter @3plates/mobile test`
- [ ] `pnpm --filter @3plates/api typecheck`
- [ ] `pnpm --filter @3plates/api test`

Manual Android gate:

- [ ] Fresh install login succeeds.
- [ ] Relaunch preserves a valid session.
- [ ] Expired session recovers or redirects correctly.
- [ ] Sign-out removes local session state.
- [ ] Deep links route to the expected screen.

Commit gate:

- [ ] Commit Android auth/session fixes after all automated and manual checks pass.

## Phase 3 - Android Progress, Workouts, and Cached State

Purpose: verify the core product flows on Android against persisted backend state.

Tasks:

- [ ] Test progress screen loading, refresh, streak display, completed workout count, and manual workout day markers.
- [ ] Test manual workout entry creation, history loading, deletion, and persistence after app restart.
- [ ] Confirm manual workouts written from Android appear in Postgres through the API.
- [ ] Test workout mode selection and workout list rendering for all supported modes.
- [ ] Test preferences loading, editing, saving, and persistence after app restart.
- [ ] Test cached reads by loading data online, blocking network, then reopening progress, preferences, workouts, and manual workout history.
- [ ] Add automated tests for any Android-discovered state bugs in shared mobile libraries or API routes.

Automated gate:

- [ ] `pnpm --filter @3plates/contract typecheck`
- [ ] `pnpm --filter @3plates/contract test`
- [ ] `pnpm --filter @3plates/mobile typecheck`
- [ ] `pnpm --filter @3plates/mobile test`
- [ ] `pnpm --filter @3plates/api typecheck`
- [ ] `pnpm --filter @3plates/api test`

Manual Android gate:

- [ ] Manual workout created on Android survives app restart.
- [ ] Manual workout created on Android is visible through another logged-in client.
- [ ] Completed workouts equals recorded manual workout count.
- [ ] Current streak shows each previous done day as a checked day.
- [ ] Cached read fallback works when the network is unavailable.

Commit gate:

- [ ] Commit Android product-state fixes after automated tests and device checks pass.

## Phase 4 - Android Notifications and Offline Writes

Purpose: finish Android native behavior for push registration and queued mutations.

Tasks:

- [ ] Test Android notification permission prompt on a fresh install.
- [ ] Confirm Expo push token creation with the configured EAS project id.
- [ ] Confirm device registration stores a valid Android notification device through the API.
- [ ] Test denied notification permission behavior.
- [ ] Test queued progress, preferences, and notification writes while offline.
- [ ] Reconnect and confirm queued writes flush without duplicating or losing state.
- [ ] Add automated tests for any queueing, token registration, or retry fixes.

Automated gate:

- [ ] `pnpm typecheck`
- [ ] `pnpm test`

Manual Android gate:

- [ ] Notification registration succeeds with granted permission.
- [ ] Permission denial is handled without blocking the rest of the app.
- [ ] Queued offline writes flush after connectivity returns.
- [ ] No duplicate notification devices or stale queued mutations remain after flush.

Commit gate:

- [ ] Commit Android notification/offline fixes after all checks pass.

## Phase 5 - Android Release Candidate

Purpose: cut a clean Android APK candidate for broad physical-device testing.

Tasks:

- [ ] Rebuild the Android APK from a clean checkout.
- [ ] Install on a physical Android device using the APK install runbook below.
- [ ] Run one full regression pass:
  - Sign-in.
  - Account linking.
  - Session refresh and expiry.
  - Progress and streak display.
  - Manual workout create, list, delete, and persistence.
  - Workout mode selection and list rendering.
  - Preferences.
  - Notification registration.
  - Offline cached reads.
  - Offline queued writes.
  - Sign-out.
- [ ] Record APK path, build profile, git commit, API target, and device details.

Automated gate:

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Android APK build completes from the release-candidate commit.

Manual Android gate:

- [ ] Full Android regression pass is complete with no blocking defects.

Commit gate:

- [ ] Commit final Android release-candidate fixes and docs.

## Phase 6 - iOS Build Foundation

Purpose: start iOS only after the Android APK gate is complete.

Tasks:

- [ ] Configure iOS bundle id, app display name, icons, splash assets, associated domains, URL scheme, permissions, and notification metadata.
- [ ] Configure iOS EAS profile and signing requirements.
- [ ] Confirm Apple developer team, provisioning, entitlements, and push notification capability.
- [ ] Confirm Apple sign-in configuration and callback URLs.
- [ ] Build an iOS simulator build or development client, then a physical-device build if signing is available.

Automated gate:

- [ ] `pnpm --filter @3plates/mobile typecheck`
- [ ] `pnpm --filter @3plates/mobile test`
- [ ] iOS build completes with the documented profile.

Manual iOS gate:

- [ ] iOS build installs and launches.
- [ ] App can reach the configured API.
- [ ] App shows the sign-in screen when no session exists.

Commit gate:

- [ ] Commit iOS build configuration after install and launch checks pass.

## Phase 7 - iOS Auth, State, Notifications, and Offline Regression

Purpose: match Android's accepted behavior on iOS.

Tasks:

- [ ] Run iOS auth, account linking, session refresh, expiry, deep-link, and sign-out checks.
- [ ] Run iOS progress, streak, manual workout, workout list, and preferences checks.
- [ ] Verify iOS notification permission prompt and token registration.
- [ ] Verify cached reads after network failure.
- [ ] Verify queued progress, preference, and notification writes flush after connectivity returns.
- [ ] Add automated tests for any iOS-discovered shared code bugs.

Automated gate:

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] iOS build completes with the documented profile.

Manual iOS gate:

- [ ] iOS matches the accepted Android behavior for account, progress, workouts, notifications, offline reads, queued writes, and sign-out.

Commit gate:

- [ ] Commit iOS fixes after all automated and manual checks pass.

## Phase 8 - Cross-Platform Release Readiness

Purpose: verify Android, iOS, and web behave as one product before store-facing work.

Tasks:

- [ ] Run web smoke checks for sign-in, progress, workouts, preferences, notifications, and sign-out.
- [ ] Compare Android, iOS, and web behavior for the same account and backend data.
- [ ] Confirm production API compatibility and environment variable handling.
- [ ] Confirm analytics, logging, and error visibility are sufficient for native beta testing.
- [ ] Document known limitations, unsupported devices, and recovery steps.

Automated gate:

- [ ] `pnpm typecheck`
- [ ] `pnpm test`

Manual gate:

- [ ] Web, Android, and iOS show consistent account, streak, workout, session, notification, and sign-out behavior.

Commit gate:

- [ ] Commit release-readiness docs and final cleanup after all checks pass.

## Android APK Install Runbook

Use this after the Android APK build gate passes.

1. On the Android device, open Settings and enable developer options by tapping Build number seven times.
2. In Developer options, enable USB debugging.
3. Connect the Android device to the computer over USB.
4. When the device asks whether to allow USB debugging, approve the computer's RSA fingerprint.
5. Verify the device is visible:

   ```sh
   adb devices
   ```

6. If the device shows as `unauthorized`, unlock the phone, approve the prompt, then run `adb devices` again.
7. Install the APK:

   ```sh
   adb install -r path/to/3plates.apk
   ```

8. If Android blocks the install because of an older incompatible signature, uninstall the previous test build and reinstall:

   ```sh
   adb uninstall your.android.application.id
   adb install path/to/3plates.apk
   ```

9. Launch 3Plates from the app drawer.
10. Confirm the app opens, reaches the configured API, and shows sign-in when no session exists.
11. Run the Android release-candidate regression checklist from Phase 5.
12. Capture logs if the app crashes or hangs:

   ```sh
   adb logcat
   ```

## Acceptance

- Android has an installable APK that passes the physical-device release-candidate regression checklist.
- iOS passes the same accepted account, state, notification, offline, and sign-out behavior after Android is accepted.
- Native notification registration stores valid device records through the shared backend model.
- Offline reads and queued writes recover without losing user state.
- Each large phase is committed only after its automated and manual gates pass.
