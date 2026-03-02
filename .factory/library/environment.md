# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Runtime
- Bun 1.3.6 (macOS arm64)
- Node available via Bun compatibility
- 16 CPU cores, 128GB RAM

## Monorepo
- Bun workspaces: `packages/*` and `apps/*` (except `apps/online-docs`)
- Packages export TypeScript source directly (no build step)
- Internal deps use `workspace:*`

## External Dependencies
- None. This mission has no cloud/external service dependencies.
- Sessions are file-based at `~/.craft-agent/workspaces/`

## Expo Mobile App
- Expo SDK 55 (React Native 0.83, React 19.2)
- Testing: Jest + jest-expo (NOT bun test — Expo requires Jest)
- react-native-sse for SSE client
- expo-secure-store for token storage
