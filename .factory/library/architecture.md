# Architecture

Architectural decisions and patterns for the Orchestra mobile mission.

**What belongs here:** Design decisions, patterns discovered, module boundaries.

---

## Gateway Architecture
- Standalone `node:http` server in `packages/mobile-gateway`
- Exports `createGatewayServer(config)` returning controllable server instance
- Accepts a SessionManager-compatible interface (not direct import)
- Routes: workspaces, sessions, messages, commands, attachments, auth, events (SSE)
- Serializers convert internal Session/Message/Event types to DTOs from mobile-contracts
- SSE uses `text/event-stream` with heartbeat pings and workspace-scoped fanout
- Auth: Bearer token middleware on all routes except health and pairing

## Mobile App Architecture
- expo-router file-based routing in `apps/mobile/src/app/`
- Route groups: `(onboarding)` for pairing flow, `(main)` for app
- Zustand stores: sessions, connection, auth
- Event processor ports reducer semantics from desktop `apps/electron/src/renderer/event-processor/`
- API client wraps REST and SSE, injects auth tokens
- Theme provider from mobile-tokens with light/dark/system

## Package Dependency Graph (New Packages)
```
mobile-contracts (no workspace deps)
  └── Shared DTOs, event types

mobile-gateway
  └── mobile-contracts (workspace:*)

mobile-tokens
  └── shared (workspace:*) — reads theme config

apps/mobile
  ├── mobile-contracts (workspace:*)
  ├── mobile-tokens (workspace:*)
  └── (does NOT depend on mobile-gateway — communicates via HTTP)
```

## Key Design Decisions
- Gateway is standalone for independent testing (not embedded in Electron until M6)
- node:http chosen over Hono/Express (zero deps, matches existing pool-server pattern)
- Default theme only (light/dark) for MVP
- Orchestra design language (sharp corners, custom chrome, NOT iOS native)
