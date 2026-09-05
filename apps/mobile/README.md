# @hyphaehub/mobile

Native mobile app (Expo + Expo Router) for field input & tracking. Shares domain types,
enums, and formatting with the rest of the platform via `@hyphaehub/core`.

A tabbed app covering the full grow loop: **Home** (live stats), **Batches** (create + list),
**Strains** (catalog), and **Settings** (plan + usage). The batch screen runs the whole
lifecycle — add a source, split into jars, combine into a tub, log events, and log harvests —
all against the same API the web app uses.

> Verified: typechecks and bundles with Metro (`expo export`). Photo capture, offline queue, and
> push reminders remain on the roadmap.

## Run it

```bash
# Defaults to the hosted cloud API. Override to hit a local Worker over your LAN:
export EXPO_PUBLIC_API_URL="http://<your-lan-ip>:8787"

pnpm --filter @hyphaehub/mobile start   # then press i / a, or scan with Expo Go
```

Sign up in the app, or sign in with an account you created on the web. On native the app
authenticates with a bearer token (better-auth's bearer plugin) stored in `expo-secure-store`,
so no cookies are required.

## Building a native APK (status: blocked)

The app is linked to EAS project `@bikeidaho/hyphaehub` and the JS bundles cleanly
(`npx expo export --platform android` succeeds). Producing a native **APK/AAB** in this
pnpm monorepo is currently blocked by a stack of Expo-SDK52 + pnpm + Windows tooling issues.
Fixes already applied (committed): SDK-aligned `react-native@0.76.9` / `react-native-screens`,
`expo-asset` as a direct dep, and `nodeLinker: hoisted` so RN tooling finds modules at the
workspace root.

The remaining blocker is a genuine conflict: the release JS-bundle step needs the Gradle
React `root` set to the **workspace root** (so Metro's server root matches the entry file),
but doing so breaks **native-module Gradle variant resolution** (`react-native-screens`,
`react-native-safe-area-context` report "No matching variant … release"). The two can't both
be satisfied with the stock config. EAS cloud builds hit the same wall and free build credits
are exhausted this billing period.

**Recommended paths forward (in order):**
1. **Extract `apps/mobile` into a standalone Expo app** (its own repo, no `workspace:*` deps —
   vendor the handful of `@hyphaehub/core` helpers it uses). A standard managed Expo app builds
   on EAS with zero of these monorepo issues. This is the cleanest, fastest route to a store build.
2. Add an Expo **config plugin** that patches `android/app/build.gradle` for the monorepo so the
   fix survives `expo prebuild` (needed for EAS, which regenerates the native project).
3. Build later on **EAS** once credits reset/upgraded — but only after (1) or (2), since EAS
   hits the same Gradle error.

## Structure

```
app/
  _layout.tsx        Root stack + AuthProvider
  login.tsx          Sign in / create account
  (tabs)/_layout.tsx Auth gate + tab bar
  (tabs)/index.tsx   Home dashboard (stats)
  (tabs)/batches.tsx Batch list + inline create
  (tabs)/strains.tsx Strain catalog
  (tabs)/settings.tsx Workspace, plan, usage, sign out
  batch/[id].tsx     Batch detail: summary, lineage stages, all grow actions
src/lib/
  api.ts             Bearer-token API client
  auth.tsx           Auth context (SecureStore-backed)
  format.ts / theme.ts
```
