---
layout: default
title: Android Handoff
---

# Android Handoff

Use this page to resume the Android rollout from a different development computer.

## Current State

- The Android production APK builds successfully.
- The app package is `com.christitustech.threeplates`.
- The production build script defaults native API traffic to `https://api.3spinningplates.com`.
- The previous white screen was caused by the signed-out startup path rendering an empty placeholder while session state was unresolved.
- The startup path now renders the branded 3Plates auth entry screen instead of a blank white view.
- The physical-device smoke test now captures a screenshot and fails a mostly white blank first screen.

## Important Files

- `apps/mobile/app/index.tsx`: signed-in state gate and signed-out entry screen.
- `apps/mobile/app/sign-in.tsx`: Google auth launch and mobile auth callback handling.
- `apps/mobile/src/components/AuthLanding.tsx`: shared branded auth entry screen.
- `apps/mobile/src/components/AuthBackground.tsx`: full-screen gym image background.
- `apps/mobile/scripts/build-android-apk.mjs`: debug and production APK builder.
- `apps/mobile/scripts/test-android-device.mjs`: installs, launches, checks logs, and screenshots the app on a USB-connected Android device.
- `docs/mobile-tasks.md`: rollout task list and APK testing commands.

## Machine Setup

Install or confirm:

- Node and pnpm. The repo currently warns when Node is outside the package engine range, but tests ran under Node `v26.4.0`.
- Java 17 with `JAVA_HOME` set.
- Android SDK with `ANDROID_HOME` set.
- Android platform tools, including `adb`.
- A physical Android device with Developer Options and USB debugging enabled.

On Windows, if native builds fail because of long paths, copy or clone the repo to a short path such as `C:\3plates` before building.

## Build And Test

From the repo root:

```powershell
npx --yes pnpm@9.15.4 install --frozen-lockfile
npx --yes pnpm@9.15.4 --filter @3plates/mobile typecheck
npx --yes pnpm@9.15.4 --filter @3plates/mobile test
npx --yes pnpm@9.15.4 --filter @3plates/mobile build:android:production
```

The production APK is copied to:

```text
apps/mobile/dist/3plates-android-production.apk
```

With the phone connected and USB debugging approved:

```powershell
npx --yes pnpm@9.15.4 --filter @3plates/mobile test:android:device -- --fresh --keep-open --timeout 15000
```

Expected artifacts:

```text
apps/mobile/dist/android-device-smoke.log
apps/mobile/dist/android-device-smoke.png
```

The screenshot should show the branded 3Plates Training Log auth entry screen, not a blank white screen.

## Last Verified In This Handoff

- `typecheck`: passed.
- `test`: passed, 19 tests.
- `build:android:production`: passed, APK size was about 44.5 MB.
- `test:android:device -- --fresh --keep-open --timeout 15000`: passed on device serial `57291FDCR007R3`.
- Visual screenshot check: passed, showing the branded auth entry screen.

## Notes For The Next Machine

- The generated APK and screenshots under `apps/mobile/dist` are local build artifacts and may not be present after a fresh clone.
- If the app shows a Metro or `localhost:8081` message, uninstall the old debug build and install the production APK from `apps/mobile/dist/3plates-android-production.apk`.
- A source scan found no `localhost`, `127.0.0.1`, `10.0.2.2`, or `8081` references in the mobile runtime outside ignored build artifacts.
- If multiple devices are connected, add `-- --device <serial>` to the smoke test command.

## Next Manual Check

After installing the production APK on the next Android device, tap through the full auth flow:

1. Launch the app and confirm the 3Plates Training Log screen renders.
2. Tap `Sign in` and confirm the next screen shows `Continue with Google`.
3. Tap `Continue with Google` and confirm the system browser opens the production auth URL.
4. Complete Google auth and confirm the app deep-links back to the progress screen.
