# Mobile App Scaffold Gotchas

- `apps/mobile` uses Expo SDK 55 + React 19.2 in a monorepo where the root workspace still has React 18.
- For Jest in `apps/mobile`, keep `jest` on v29 to match `jest-expo` 55.
- Jest needs explicit `moduleNameMapper` entries for React and `react-test-renderer` to avoid version-resolution issues from hoisted deps.
- `react-native-safe-area-context` should be mocked in tests (`SafeAreaProvider` passthrough) or rendered trees may appear empty.
