# Expo SDK + Expo Router Research (Early 2026)

**Scope:** Expo SDK + Expo Router best practices for a React Native iOS app in a Bun monorepo with Zustand, TanStack Query, and SSE needs.

## 1) Expo SDK (latest stable)

**Recommended version:** **Expo SDK 55** (released Feb 25, 2026). Includes **React Native 0.83** and **React 19.2**. SDK 56 is planned for Q2 2026 with RN 0.85.  
**Docs:** https://expo.dev/changelog/sdk-55

**Key patterns / changes**
- **New template structure:** default template now uses **`/src/app`** for routes and app code.  
- **Legacy architecture removed:** SDK 55 **drops the legacy architecture**. `newArchEnabled` is removed. All apps are on the New Architecture.  
- **Expo SDK package versioning:** SDK packages now share the SDK major version (e.g., `expo-router@^55.0.0`).  
- **Expo Go transition:** Expo Go stays on SDK 54 for a short period; for SDK 55 you should use **development builds**.  

**Gotchas / breaking changes**
- **New Architecture only** (legacy removed) — any libraries requiring legacy mode must be replaced or upgraded.  
- **Hermes v1 (opt‑in)** requires **building RN from source** and **not recommended for Android monorepos** until RN issue #1235 is resolved.  

**References**
- SDK 55 changelog: https://expo.dev/changelog/sdk-55  
- Upgrade guide: https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/

---

## 2) expo-router (file‑based routing)

**Recommended version:** **`expo-router` ~55.0.3** (bundled with SDK 55).  
**Docs:** https://docs.expo.dev/versions/latest/sdk/router/

**Key patterns / idioms**
- **Routes live in `src/app`**; every file is a route and has a URL. `_layout.tsx` defines navigation relationships.  
- **Route groups** via parentheses: `(tabs)` groups routes without changing URL.  
- **Dynamic routes** via brackets: `[id].tsx` + `useLocalSearchParams`.  
- **Root layout** (`src/app/_layout.tsx`) replaces `App.tsx` and hosts providers / initialization.  
- **Layout files** can render `Stack`, `Tabs`, `NativeTabs`, or `Slot` depending on navigation needs.  

**Typed routes**
- **Enable with** `experiments.typedRoutes: true` in `app.json`, and run `npx expo customize tsconfig.json`.  
- Types are generated on `npx expo start`, and stored in `expo-env.d.ts` (gitignored).  
- **Relative paths are not supported** for typed `href`; use absolute paths or `useSegments()`.  

**Gotchas / breaking changes**
- Typed routes are still **beta**; generated files are gitignored and must remain.  
- If you enable typed routes, `tsconfig.json` gets updated to include `expo-env.d.ts` and `.expo`.  

**References**
- Core concepts: https://docs.expo.dev/router/basics/core-concepts/  
- Layouts: https://docs.expo.dev/router/basics/layout/  
- Notation: https://docs.expo.dev/router/basics/notation/  
- Typed routes: https://docs.expo.dev/router/reference/typed-routes/  
- Router API (config + components): https://docs.expo.dev/versions/latest/sdk/router/

---

## 3) SSE in React Native (EventSource)

**Recommended library:** **`react-native-sse` (EventSource polyfill)** — no native modules, uses `XMLHttpRequest`, supports TS.  
**Docs:** https://www.npmjs.com/package/react-native-sse

**Key patterns / idioms**
- `new EventSource(url, options)` + `addEventListener('open'|'message'|'error'|'close')`.  
- Use `react-native-url-polyfill/auto` if you rely on `URL` to compose SSE endpoints.  
- Use `Content-Type: text/event-stream` server-side; handle reconnects via `pollingInterval` (default 5000ms).  

**Gotchas / breaking changes**
- **Debug/dev builds** can block SSE streams (Android especially) due to dev network inspection interceptors. See Expo issue #27526. Symptoms are “open” events but no messages.  
- **Expo Go / expo-dev-client** can behave differently from release builds. Test SSE in **release/dev builds** (not just Expo Go) and keep a fallback (e.g., polling) for dev.  

**References**
- Library README: https://www.npmjs.com/package/react-native-sse  
- Expo debug interceptor issue: https://github.com/expo/expo/issues/27526

---

## 4) expo-secure-store (token storage)

**Recommended version:** **`expo-secure-store` ~55.0.8** (bundled with SDK 55).  
**Docs:** https://docs.expo.dev/versions/latest/sdk/securestore/

**Key patterns / idioms**
- Use async APIs: `setItemAsync`, `getItemAsync`, `deleteItemAsync`, `isAvailableAsync`.  
- Configure via config plugin for **Face ID permission** and **Android backup exclusion**.  

**Gotchas / breaking changes**
- **iOS Keychain persists across reinstall** (same bundle ID).  
- **Large values (~2KB)** may be rejected on iOS.  
- `requireAuthentication` **not supported in Expo Go** (missing `NSFaceIDUsageDescription`).  

**References**
- API + config plugin: https://docs.expo.dev/versions/latest/sdk/securestore/

---

## 5) react-native-reanimated (animations)

**Recommended version:** **Reanimated 4.x** (requires New Architecture / Fabric).  
**Docs:** https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/

**Key patterns / idioms**
- Reanimated 4 runs animations on the **UI thread** with worklets.  
- **Install** `react-native-reanimated` **and** `react-native-worklets`.  
- **Expo projects:** run `npx expo prebuild` after installation to update native code.  

**Gotchas / breaking changes**
- **Reanimated 4 requires New Architecture.** If you must stay on the old architecture, use **Reanimated 3**.  
- Worklets Babel plugin must be **last** if you configure it manually. Expo templates include it since SDK 50.  

**References**
- Getting started: https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/

---

## 6) Testing Expo apps with Bun

**Recommended test setup:** **Jest + `jest-expo`** (Expo’s official approach).  
**Docs:** https://docs.expo.dev/develop/unit-testing/

**Key patterns / idioms**
- Install: `npx expo install jest-expo jest @types/jest --dev`.  
- Configure in `package.json`: `"jest": { "preset": "jest-expo" }`.  
- Use **React Native Testing Library**: `npx expo install @testing-library/react-native --dev`.  
- React 19+: **`react-test-renderer` is deprecated** for RN testing (use RTL).  

**Gotchas / breaking changes**
- Expo docs do **not** recommend Bun’s native test runner for Expo; use **Jest** for compatibility.  
- Some `transformIgnorePatterns` tweaks may be needed for non‑transpiled RN packages.  

**References**
- Unit testing with Jest: https://docs.expo.dev/develop/unit-testing/

---

## 7) Monorepo support (Bun workspaces)

**Recommended approach:** **Expo monorepo guide + Bun workspaces**.  
**Docs:** https://docs.expo.dev/guides/monorepos/  
**Bun workspaces:** https://bun.com/docs/guides/install/workspaces

**Key patterns / idioms**
- Root `package.json` with **`workspaces: ["apps/*", "packages/*"]`**.  
- Expo **auto-configures Metro** for monorepos **since SDK 52**.  
- Use `workspace:*` (Bun/npm/pnpm) for local package dependencies.  

**Gotchas / breaking changes**
- **Do not manually set** `watchFolders` / `resolver.*` in `metro.config.js` for SDK 52+.  
- **Duplicate React / React Native** versions in a monorepo will break builds/runtime.  
- **Isolated installs:** SDK 54+ supports isolated dependencies (Bun/pnpm); if issues occur, consider hoisting (`node-linker=hoisted` for pnpm).  
- **Autolinking in monorepos:** SDK 55 enables `experiments.autolinkingModuleResolution` automatically.  

**References**
- Expo monorepos: https://docs.expo.dev/guides/monorepos/

---

## 8) TypeScript configuration (monorepo‑friendly)

**Recommended baseline:** `tsconfig.json` extends `expo/tsconfig.base`.  
**Docs:** https://docs.expo.dev/guides/typescript/

**Key patterns / idioms**
- Generate config: `npx expo customize tsconfig.json`.  
- Use **path aliases** via `compilerOptions.paths` and `baseUrl`.  
- Disable path alias resolution via `experiments.tsconfigPaths: false` if needed.  

**Gotchas / breaking changes**
- Typed routes **modify `tsconfig.json`** includes and create `expo-env.d.ts` (gitignored). Don’t remove it.  
- If you use TypeScript for config files, use `tsx` and `require('tsx/cjs')`.  

**References**
- TypeScript guide: https://docs.expo.dev/guides/typescript/
- Typed routes + tsconfig: https://docs.expo.dev/router/reference/typed-routes/

---

## Quick recommendations (at a glance)

- **SDK:** Expo SDK **55** (RN 0.83, React 19.2).  
- **Router:** `expo-router` **~55.0.3**, routes in `src/app`, use `_layout.tsx`.  
- **SSE:** `react-native-sse` + URL polyfill, test in release/dev builds due to debug interceptor issues.  
- **Secure storage:** `expo-secure-store` (async APIs + config plugin).  
- **Animations:** Reanimated **4.x** (New Architecture only).  
- **Testing:** Jest + `jest-expo` + React Native Testing Library.  
- **Monorepo:** Bun workspaces + Expo monorepo auto Metro config (SDK 52+).  
- **TS:** extend `expo/tsconfig.base`, prefer path aliases, keep typed‑routes generated files.

***End of report***
