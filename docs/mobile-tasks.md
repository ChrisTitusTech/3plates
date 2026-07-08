---
layout: default
title: Mobile Tasks
---

# Mobile Tasks

Status: Android production APK ready for physical-device install
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

## Current Android Build Decisions

- App display name: `3Plates`.
- Android application id: `com.christitustech.threeplates`.
- iOS bundle identifier seed: `com.christitustech.threeplates`.
- Custom native URL scheme: `threeplates`.
- Native auth callback path: `auth/callback`.
- Native auth redirect URL: `threeplates://auth/callback`.
- Production API URL: `https://api.3spinningplates.com`.
- Android emulator local API URL: `http://10.0.2.2:3000`.
- Physical Android local API URL: use the development computer LAN IP with port `3000`, or use the production API for release-candidate APKs.
- APK build strategy: generate the Android project with Expo prebuild and build a bundled production APK locally with the Gradle wrapper. EAS profiles are still documented for the later cloud/internal distribution path.
- Current production APK output: `apps/mobile/dist/3plates-android-production.apk`.
- Debug APKs are Metro development builds and can show `localhost:8081` script errors unless Metro is running; do not use debug APKs for production Android validation.
- Do not package server secrets or private API keys in native builds. APKs may include public config only, such as `EXPO_PUBLIC_API_URL` and a public Expo project id. OAuth, database, provider, and signing secrets must remain server-side.
- Windows native builds need a short real checkout path because React Native CMake object paths can exceed the 260-character Windows process limit under `C:\Users\...`. The verified local build used `C:\3p-apk` with a pnpm virtual store at `C:\p\3p-apk`.

## Installed Android Toolchain

- JDK: Temurin 17 at `C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot`.
- Android SDK: `C:\Users\chris\AppData\Local\Android\Sdk`.
- Android command-line tools: `cmdline-tools;latest`, sdkmanager `21.0`.
- Android platform-tools: `37.0.0`, including `adb`.
- Android platforms: `android-36`, `android-36.1`.
- Android build-tools: `35.0.0`, `35.0.1`, `36.0.0`.
- Android NDK: `27.1.12297006`.
- Android CMake: `3.22.1`.
- User environment variables set: `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`.
- User `Path` includes `%JAVA_HOME%\bin`, `%ANDROID_HOME%\platform-tools`, and `%ANDROID_HOME%\cmdline-tools\latest\bin`.
- No physical Android device was attached during the inventory check; `adb devices` returned an empty device list.

## Phase 0 - Mobile Build Inventory

Purpose: make the native build path explicit before Android implementation starts.

Tasks:

- [x] Confirm final mobile identifiers:
  - Android application id: `com.christitustech.threeplates`.
  - iOS bundle identifier seed: `com.christitustech.threeplates`.
  - App display name: `3Plates`.
  - Custom URL scheme for OAuth and deep links: `threeplates`.
- [x] Confirm native API targets:
  - Android emulator local API URL: `http://10.0.2.2:3000`.
  - Physical Android local API URL: development computer LAN IP with port `3000`.
  - Production API URL: `https://api.3spinningplates.com`.
  - Staging API URL: none currently configured.
- [x] Confirm OAuth redirect URLs needed by Google and Apple for native auth exchange.
  - Native app callback: `threeplates://auth/callback`.
  - Backend OAuth callback: `${AUTH_BASE_URL}/auth/callback`.
  - Google and Apple provider callback configuration must include the backend callback URL.
- [x] Confirm Expo account, EAS project, and project id requirements for native push tokens.
  - Native notification token creation reads `extra.eas.projectId` from Expo config.
  - Use `EXPO_PUBLIC_EAS_PROJECT_ID` locally until an EAS project id is committed or linked.
- [x] Record available test devices:
  - Physical Android: none attached during inventory.
  - Android emulator: no emulator image installed during inventory.
  - Physical iPhone: not checked for Android-first rollout.
  - iOS simulator: not checked for Android-first rollout.

Automated gate:

- [x] `pnpm --filter @3plates/mobile typecheck`
- [x] `pnpm --filter @3plates/mobile test`

Commit gate:

- [x] Commit documentation and configuration decisions after the automated gate passes.

## Phase 1 - Android Build Foundation

Purpose: create a repeatable Android APK build that can be installed on a
physical device.

Tasks:

- [x] Add committed Expo app configuration if still missing (`app.json` or `app.config.ts`).
- [x] Configure Android package id, app name, icons, splash assets, permissions, deep-link scheme, and notification metadata.
- [x] Add `eas.json` profiles for at least:
  - Android internal APK testing.
  - Android production or preview build.
  - iOS placeholder profile for the later iOS phase.
- [x] Decide whether the first Android APK is built with local EAS, cloud EAS, or a generated native Android project.
- [x] Document any required local Android tooling: JDK, Android SDK, `adb`, environment variables, and signing credentials.
- [x] Ensure `EXPO_PUBLIC_API_URL` is injected for Android builds instead of relying on `localhost`.
- [x] Verify the notification registration path can read an EAS project id at runtime.

Automated gate:

- [x] `pnpm --filter @3plates/mobile typecheck`
- [x] `pnpm --filter @3plates/mobile test`
- [x] Android APK build completes from a phase-scoped short-path worktree using the documented profile.

Evidence from 2026-07-08:

- Typecheck and 18/18 mobile tests passed from short-path worktree `C:\3p-apk`.
- Android debug APK build passed with `pnpm --filter @3plates/mobile build:android:debug`.
- APK copied to `apps/mobile/dist/3plates-android-debug.apk`.
- APK metadata verified with `aapt dump badging`: package `com.christitustech.threeplates`, label `3Plates`, min SDK `24`, target SDK `36`, version `0.1.0`.
- `adb devices` returned no attached devices, so physical install and launch validation is still pending.

Production APK correction from 2026-07-08:

- Physical Android launch of the debug APK showed a `localhost:8081` Metro script error.
- Production native API fallback was changed to `https://api.3spinningplates.com`.
- `babel-preset-expo` was added as an explicit mobile dev dependency so Metro release bundling can resolve the configured Babel preset.
- Production release APK build passed from short-path worktree `C:\3p-prod` using the committed `build:android:production` command with the script's default `arm64-v8a` native target and embedded `assets/index.android.bundle`.
- Production APK copied to `apps/mobile/dist/3plates-android-production.apk`.
- Production APK metadata verified with `aapt dump badging`: package `com.christitustech.threeplates`, label `3Plates`, min SDK `24`, target SDK `36`, version `0.1.0`, native code `arm64-v8a`.
- Production APK SHA-256: `3F1032DD727419B0265F4A8E1D95EAD845A04897F5104BA79A2DC796F732B8F2`.
- `adb devices` returned no attached devices after the production APK build, so install validation still needs the phone connected.
- Use `pnpm --filter @3plates/mobile build:android:production` for physical Android production validation.

Manual Android gate:

- [ ] APK installs on a physical Android device.
- [ ] App launches without a white screen or native crash.
- [ ] App can reach the configured API from the physical device.
- [ ] App shows the sign-in screen when no session exists.

Commit gate:

- [x] Commit Android build configuration and docs after the APK build is verified. Physical install and launch validation remains pending until a device is attached.

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
7. From the repository root, install the APK:

   ```sh
   adb install -r apps/mobile/dist/3plates-android-production.apk
   ```

8. If Android blocks the install because of an older incompatible signature, uninstall the previous test build and reinstall:

   ```sh
   adb uninstall com.christitustech.threeplates
   adb install apps/mobile/dist/3plates-android-production.apk
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
