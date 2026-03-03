# Orchestra Expo iOS Implementation Plan

This document defines a full implementation plan for an iOS Expo app that preserves Orchestra/Orchestra behavior and design language while using the Mac desktop app as the runtime host.

## Decision Summary

Build iOS as a **remote client** to the existing Electron runtime.

- Keep `apps/electron/src/main` authoritative for sessions, tools, and local system access.
- Add a mobile gateway in Electron (REST + SSE).
- Build a new Expo iOS app (`apps/mobile`) with native UI primitives that map to the current design system.

Why:

- The renderer is tightly coupled to `window.electronAPI` and desktop-only capabilities.
- iOS cannot host Node/Electron internals directly.
- A contract-first remote client gives parity with lower risk than a renderer port.

## Product Goal

Pick up iPhone and continue the exact same conversation/workflow you started on desktop, with no meaningful capability downgrade for core chat workflows.

## Implementation Status Snapshot (As of 2026-03-02)

| Phase | Status | Current Evidence | Remaining Gap |
| --- | --- | --- | --- |
| 1. Contract + Gateway Foundation | Implemented (Core) | Dedicated runtime gateway server exists in `packages/mobile-gateway/src/runtime-server.ts`; Electron startup/shutdown + SSE event bridge are wired via `apps/electron/src/main/mobile-gateway.ts` and `apps/electron/src/main/index.ts`. | Add integration coverage for gateway lifecycle failures and document local-network deployment defaults for end users. |
| 2. Messaging + Streaming Core | Implemented (MVP Core) | Message, interrupt, kill, command, and SSE behavior are implemented/tested in `packages/mobile-gateway`; mobile chat route now renders streamed timeline + composer controls in `apps/mobile/src/app/(main)/session/[sessionId].tsx`. | Expand renderer fidelity for desktop-level markdown/code/tool presentation polish. |
| 3. Pairing + Security + Network | Implemented (MVP) | End-to-end onboarding pairing flow exists in `apps/mobile/src/app/(onboarding)/{welcome,find-runtime,confirm-pair,pair-success}.tsx`; pair start/confirm/refresh/revoke and secure token storage are wired. | Add host auto-discovery, richer re-pair recovery, and network diagnostics UX. |
| 4. Mobile Shell + Navigation | Implemented (MVP Core) | Expo app scaffold + onboarding + sessions home + chat route are in place (`apps/mobile/src/app/(onboarding)/*`, `apps/mobile/src/app/(main)/index.tsx`, `apps/mobile/src/app/(main)/session/[sessionId].tsx`). | Add settings and diagnostics routes to complete the shell. |
| 5. Design System + Theme Parity | Partial | `packages/mobile-tokens` exists; core UI primitives and theme provider exist in `apps/mobile/src/components/ui` and `apps/mobile/src/theme`. | Workspace override themes and full screen-level parity are not applied yet. |
| 6. Attachments + Interaction Completeness | Partial | Attachment API client, command API, and reducer support for permission/credential events exist. | Attachment picker/progress UI, permission cards, and tool timeline UI are not implemented yet. |
| 7. QA + Performance + Release | Partial | Strong package-level tests exist (gateway, reducer, client, SSE, auth store, tokens). | No mobile E2E flow coverage and no TestFlight rollout pipeline yet. |

### What This Means Right Now

- Gateway runtime wiring and phone pairing are now implemented end-to-end.
- The critical path is now Step 5 and Step 6: attachments/interactions and settings/diagnostics.
- Design-system parity must stay strict by continuing to use existing mobile primitives and theme tokens.

## Expo Go Launch Reliability (Audit on 2026-03-03)

This section captures the exact cause of the "tap development server and nothing happens" issue and the stable launch path.

### Root Causes Found

1. Wrong project root:
   - Running `npx expo start` from `/orchestra` starts Expo against the repo root, not `apps/mobile`.
   - Result: Metro iOS bundling fails (`Unable to resolve "../../App" from "node_modules/expo/AppEntry.js"`).
2. Wrong runtime mode:
   - In `apps/mobile`, plain `expo start` defaults to **development build** mode because `expo-dev-client` is installed.
   - Result: server URL is `exp+orchestra-mobile://...` (dev-client link), which Expo Go cannot open.

### Stable Launch Commands

Use one of these from repo root:

1. `bun run mobile:start` (LAN + Expo Go)
2. `bun run mobile:start:tunnel` (Tunnel + Expo Go)

Or directly in `apps/mobile`:

1. `npx expo start --go`
2. `npx expo start --go --tunnel`

### Mode Check Before Scanning QR

In terminal output, confirm:

- `Using Expo Go`
- not `Using development build`

If it says development build, press `s` to switch, or restart with `--go`.

## Physical iPhone Dev-Build Recovery Log (Executed on 2026-03-03)

This section documents the exact work completed to move from "Runtime unreachable" on a physical iPhone to a working paired session.

### 1. Switched from Expo Go path to iOS dev build

Actions:

1. Built and installed the iOS development build from `apps/mobile` with `npx expo run:ios --device`.
2. Installed iOS native dependencies/pods required by the generated iOS workspace.

User narrative:

- Users are no longer blocked by Expo Go app/version constraints and can run the app against the project's actual native/runtime stack.

### 2. Ensured Electron mobile gateway is actually running on LAN

Actions:

1. Wired mobile gateway lifecycle into Electron main startup/shutdown.
2. Added `SessionManager` event-listener support needed by the gateway event bridge.
3. Verified runtime health from both loopback and LAN:
   - `curl http://127.0.0.1:7842/api/health`
   - `curl http://192.168.4.29:7842/api/health`

User narrative:

- Users get a real reachable runtime endpoint from phone, instead of pairing against a port that is not serving mobile APIs.

### 3. Kept Metro in dev-client mode on LAN and validated launch

Actions:

1. Started Metro with dev-client LAN URL (`exp+orchestra-mobile://...url=http://192.168.4.29:8081`).
2. Launched installed app on device with `xcrun devicectl device process launch`.

User narrative:

- Users can open the installed Orchestra app and connect to the running bundle without manual URL juggling.

### 4. Fixed runtime-host and recovery behavior in mobile app

Actions (code-level):

1. Added shared runtime host normalization/URL utilities:
   - `apps/mobile/src/runtime-host.ts`
2. Normalized persisted runtime host during auth hydrate/set:
   - `apps/mobile/src/state/auth-store.ts`
3. Updated onboarding host flow to validate host and only persist host after successful runtime health/pair-start:
   - `apps/mobile/src/app/(onboarding)/find-runtime.tsx`
4. Updated API/SSE clients to build URLs safely from normalized runtime origin:
   - `apps/mobile/src/api/client.ts`
   - `apps/mobile/src/api/sse-client.ts`
5. Treated auth `403` as re-pair required (same class as expired auth):
   - `apps/mobile/src/api/client.ts`
6. Made "Re-pair Device" route deterministically to onboarding from both main and session screens:
   - `apps/mobile/src/app/(main)/index.tsx`
   - `apps/mobile/src/app/(main)/session/[sessionId].tsx`

User narrative:

- Users can recover from bad/stale host or auth states directly on phone instead of being trapped in repeated "Runtime unreachable" loops.

### 5. Fixed dev-client runtime crash caused by dependency drift

Actions:

1. Identified `apps/mobile` resolving wrong React version (`18.3.1`) after local dependency churn.
2. Restored React to the expected app version (`19.2.0`) and restarted Metro with cache clear.

User narrative:

- Users get a stable app launch path without Hermes startup crashes.

### 6. Fixed pairing-code mismatch source of "invalid pairing code"

Actions (code-level):

1. Added pairing-session code to auth pairing state:
   - `apps/mobile/src/state/auth-store.ts`
2. Stored `pairStart.code` from the same server-issued pairing session:
   - `apps/mobile/src/app/(onboarding)/find-runtime.tsx`
3. Auto-submitted that exact session code on confirm screen:
   - `apps/mobile/src/app/(onboarding)/confirm-pair.tsx`

Why this was required:

- Manual codes generated outside the phone's own `pairStart` session can never confirm that phone session (`pairingId` mismatch), even if the code itself is valid for a different session.

User narrative:

- Users no longer need to manually copy a separate pairing code source; pairing now completes reliably from the same flow that created the session.

### 7. Verification outcomes

1. iOS app installs and launches on the physical iPhone.
2. Metro bundle loads over LAN.
3. Runtime `/api/health` is reachable from LAN and loopback.
4. Pairing flow now succeeds end-to-end from device onboarding.

## Scope

### In Scope (MVP)

- Pair iPhone to a Mac-hosted Orchestra runtime.
- List/create/delete sessions.
- Open session with full message history.
- Send messages and receive live streaming events.
- Show tool activity, status, and errors.
- Interrupt active runs and kill background shells.
- Session metadata controls: rename, status, read/unread, permission mode.
- Attachments upload from iOS.
- Theme parity based on existing theme tokens and presets.

### Out of Scope (MVP)

- Full desktop settings parity.
- Full automation management UI.
- Complex tree/session hierarchy actions (cascade/reorder).
- Desktop window-specific behavior.

## Canonical Sources To Reuse

### Contracts and Session Semantics

- `apps/electron/src/shared/types.ts`
  - `Session`, `SessionEvent`, `SessionCommand`, `CreateSessionOptions`, `SendMessageOptions`.
- `packages/core/src/types/message.ts`
  - Canonical `Message` and `StoredMessage` structures.
- `apps/electron/src/main/sessions.ts`
  - Event production and state transitions.
- `apps/electron/src/renderer/event-processor/*`
  - Existing reducer semantics to mirror on mobile.

### Theme, Tokens, and Design Language

- `packages/shared/src/config/theme.ts`
  - `ThemeColors`, `SurfaceColors`, `ThemeOverrides`, `ThemeFile`, `PresetTheme`.
- `apps/electron/resources/themes/*.json`
  - Existing shipped themes and metadata.
- `packages/ui/src/styles/index.css`
  - Base token system (semantic colors, typography, spacing, radius).
- `apps/electron/src/renderer/components/ui/*`
  - Variant behavior for primitives (button/input/badge/etc.).

## Target Architecture

### Runtime Ownership

- **Mac Electron runtime**: source of truth for sessions and agent execution.
- **Expo iOS client**: presentation + user input.

### Transport

- REST for request/response operations.
- SSE for live session/workspace event stream.

### Security Model

- Explicit pairing flow.
- Short-lived access token + refresh/re-pair flow.
- Device revocation support.
- Network restricted to local/Tailscale access paths.

## Mobile Gateway Design (Electron)

Add: `apps/electron/src/main/mobile-gateway/`

- `server.ts` - HTTP bootstrap and lifecycle.
- `auth.ts` - pairing, token validation, revocation.
- `routes/workspaces.ts`
- `routes/sessions.ts`
- `routes/messages.ts`
- `routes/commands.ts`
- `routes/attachments.ts`
- `events/sse-broker.ts` - workspace-scoped event fanout.
- `serializers/*.ts` - stable DTO shaping from internal types.

Integrate with `SessionManager` event emission (`sendEvent`) rather than duplicating state logic.

## API Contract (MVP)

### Session + Workspace Endpoints

1. `POST /api/pair/start`
2. `POST /api/pair/confirm`
3. `GET /api/health`
4. `GET /api/workspaces`
5. `GET /api/workspaces/:workspaceId/sessions`
6. `POST /api/workspaces/:workspaceId/sessions`
7. `GET /api/sessions/:sessionId`
8. `DELETE /api/sessions/:sessionId`
9. `POST /api/sessions/:sessionId/messages`
10. `POST /api/sessions/:sessionId/interrupt`
11. `POST /api/sessions/:sessionId/shells/:shellId/kill`
12. `POST /api/sessions/:sessionId/commands`
13. `POST /api/sessions/:sessionId/attachments`
14. `GET /api/workspaces/:workspaceId/events` (SSE)

### `commands` MVP Subset

- `rename`
- `setSessionStatus`
- `markRead`
- `markUnread`
- `setPermissionMode`

### Event Types (MVP Stream)

- `user_message`
- `text_delta`
- `text_complete`
- `tool_start`
- `tool_result`
- `status`
- `info`
- `error`
- `typed_error`
- `interrupted`
- `complete`
- `permission_request`
- `credential_request`
- `usage_update`
- `session_created`
- `session_deleted`
- `session_status_changed`
- `name_changed`
- `session_flagged`
- `session_unflagged`

## Expo iOS App Architecture

Create `apps/mobile/`:

- `app/` (expo-router routes)
- `src/api/` (REST + SSE client)
- `src/contracts/` (imports from `packages/mobile-contracts`)
- `src/state/` (Zustand stores + reducers)
- `src/theme/` (theme resolution + token mapping)
- `src/components/` (mobile primitives + feature components)
- `src/features/sessions/`
- `src/features/chat/`
- `src/features/settings/`
- `src/utils/`

Recommended stack:

- Expo + TypeScript
- expo-router
- Zustand
- TanStack Query
- Native SSE client
- expo-secure-store (token storage)
- react-native-safe-area-context
- react-native-reanimated + gesture-handler

## Design System Port Strategy (iOS)

Do not share DOM/Radix components directly. Share semantics and tokens.

### Token Strategy

1. Create `packages/mobile-tokens` from:
   - `packages/shared/src/config/theme.ts`
   - `apps/electron/resources/themes/*.json`
   - token defaults from `packages/ui/src/styles/index.css`
2. Export RN-friendly tokens:
   - semantic colors
   - text styles
   - spacing scale
   - radius scale
   - elevation/shadow presets

### Primitive Mapping

- Desktop `Button` variants -> RN `Pressable` + variant tokens
- Desktop `Input` -> RN `TextInput` wrapper
- Desktop `Badge` -> RN `View/Text` variant wrapper
- Desktop popovers/dialogs -> iOS sheet/modal patterns
- Sidebar -> drawer/bottom sheet

### Theme Behavior Parity

- Support app default + workspace override + preset themes.
- Support light/dark/system and dark-only theme handling.
- Scenic themes:
  - support background image mode where practical
  - enforce readable fallback surfaces (`popoverSolid`) on iOS.

## iOS UX Specification (MVP)

### UX Principles

1. Mobile is a continuation surface, not a separate runtime.
2. Connection state is always visible and never silent.
3. Streaming and tool activity should feel equivalent to desktop, adapted for small screens.
4. Safety-sensitive actions (permissions, credentials, interrupts) must be explicit and reversible.
5. Frequent actions should be available in one tap from the current screen.

User narrative:

- Users should feel they are in the same Orchestra workflow on iPhone, not a reduced companion app.
- Users should always know whether the app is connected and what to do when it is not.

### Information Architecture

1. `OnboardingStack`
   - `Welcome`
   - `Find Runtime`
   - `Confirm Pair`
   - `Pair Success`
2. `MainStack`
   - `Sessions Home`
   - `Chat`
3. Global overlays
   - connection banner
   - permission/credential prompts
   - attachment picker
   - transient error/success toasts

User narrative:

- Users get a simple first-run funnel, then a focused two-screen daily workflow.
- Users can complete critical actions without losing context in deep navigation trees.

### Screen Specs

#### 1) Onboarding and Pairing

Screens:

1. `Welcome`
   - one-sentence explanation of remote runtime model
   - primary CTA: `Pair Device`
   - secondary CTA: `How It Works`
2. `Find Runtime`
   - discovered hosts list (`name`, `status`, `last seen`)
   - manual URL input fallback
   - retry/refresh discovery control
3. `Confirm Pair`
   - 6-digit segmented code input
   - paste support
   - countdown/expiration indicator
   - invalid/expired guidance and retry path
4. `Pair Success`
   - clear completion confirmation
   - CTA: `Open Sessions`

Interaction details:

- During discovery failure, keep manual entry visible instead of hiding behind another step.
- During code entry, auto-advance focus and auto-submit when all digits are present.
- Preserve entered host between retries to minimize repeated typing.

User narrative:

- Users can connect quickly even when local discovery is imperfect.
- Users get secure pairing without account setup friction.

#### 2) Sessions Home

Screen anatomy:

- Header: workspace switcher, connection chip, new session action.
- List cells: session title, last message preview, status badge, unread indicator, relative time.
- Footer states: loading more, end-of-list marker.

Interactions:

1. Tap cell -> open chat.
2. Swipe left -> mark read/unread.
3. Swipe right -> delete (confirmation required).
4. Pull-to-refresh -> requery sessions.
5. Long-press -> action sheet (`rename`, `status`, `permission mode`, `delete`).

State handling:

- Empty state with `Create Session` CTA and one-line explanation.
- Offline state retains cached list and disables destructive actions when needed.

User narrative:

- Users can quickly scan, triage, and resume conversations.
- Users can perform common maintenance actions without opening each session.

#### 3) Chat

Screen anatomy:

- Header: session title, status, connection state, overflow menu.
- Timeline: user/assistant messages, streaming output, tool events, status/info/error rows.
- Composer: multiline input, send, attach, contextual interrupt control.

Interactions:

1. Send message with optimistic local echo.
2. Stream assistant output using `text_delta` updates.
3. Expand/collapse tool cards for details.
4. Interrupt active run from persistent control in header/composer.
5. Open overflow sheet for session metadata actions.

Message rendering rules:

- Keep streamed assistant block pinned while active, then finalize on `text_complete`.
- Show typed errors with readable labels and concise next-step copy.
- Group tool activity chronologically with expandable payload/result details.

Scroll behavior:

- Auto-follow while user is at bottom and stream is active.
- Suspend auto-follow if user scrolls upward; show `Jump to Live` affordance.
- Restore position on reconnect without dropping unread streamed content.

User narrative:

- Users can monitor live work clearly and intervene quickly when needed.
- Users can trust that streamed progress and tool output are not lost during navigation/network changes.

#### 4) Permission and Credential Requests

Presentation:

- Inline approval cards anchored in timeline context.
- Clear action choices (approve/deny or provide credential).
- Optional scope control when supported (`this session only`).

Behavior:

- Block dependent steps until resolution while preserving visibility of prior context.
- Persist pending request state across app background/foreground transitions.

User narrative:

- Users keep control over sensitive operations without leaving the conversation.
- Users can resolve blockers quickly from phone and keep tasks moving.

#### 5) Attachments

Entry points:

- Composer attachment button.
- Source picker: camera, photo library, files.

Upload UX:

- Per-file progress row with cancel/retry.
- MIME/size validation before upload.
- Successful attachments appear as image preview or file chip in timeline.

Failure UX:

- Distinguish transient network failure from unsupported file type.
- Offer one-tap retry for transient failures.

User narrative:

- Users can add context from their phone immediately and unblock the agent.
- Users understand failures and can recover without redoing the whole message.

#### 6) Settings (MVP-Light)

Sections:

1. `Connected Runtime`
   - host identity
   - last sync time
   - unpair/revoke this device
2. `Appearance`
   - system/light/dark mode selector
   - workspace theme preview
3. `Diagnostics`
   - SSE connection status
   - app/runtime version details
   - copy diagnostic bundle action

User narrative:

- Users can self-serve common connectivity and appearance changes.
- Users can provide useful diagnostics when troubleshooting.

### Cross-Cutting UX Behaviors To Lock Early

1. Real-time connection banner (`connected`, `reconnecting`, `offline`) on all primary screens.
2. Reconnect strategy with exponential backoff and clear manual retry action.
3. Queued-send behavior when temporarily offline.
4. Accessible touch targets and dynamic type support for all core controls.
5. Haptics for key state changes (send success, interrupt acknowledged, error).

User narrative:

- Users avoid silent failures and always know app state.
- Users get predictable behavior under unreliable mobile network conditions.

### Route Map and Component Inventory

Proposed route map (`apps/mobile/app/`):

1. `/(onboarding)/welcome.tsx`
2. `/(onboarding)/find-runtime.tsx`
3. `/(onboarding)/confirm-pair.tsx`
4. `/(onboarding)/pair-success.tsx`
5. `/(main)/sessions/index.tsx`
6. `/(main)/chat/[sessionId].tsx`
7. `/(main)/settings/index.tsx`

Core component inventory (`apps/mobile/src/components/`):

- `ConnectionBanner`
- `SessionListItem`
- `SessionActionSheet`
- `MessageBubble`
- `StreamingBlock`
- `ToolEventCard`
- `PermissionRequestCard`
- `CredentialRequestCard`
- `AttachmentUploadRow`
- `Composer`
- `InterruptButton`
- `RuntimeStatusChip`

User narrative:

- Users get consistent interactions across screens because shared components encode the same behavior patterns.
- Engineering can ship faster with fewer regressions by implementing a clear route and component contract from day one.

## Detailed Implementation Phases

### Phase 1: Contract and Gateway Foundation

Work:

1. Create `packages/mobile-contracts` and freeze MVP DTOs/events.
2. Implement mobile gateway skeleton in Electron main process.
3. Add health/workspace/session list/read/create/delete endpoints.
4. Add workspace-scoped SSE broadcaster.

User narrative:

- Users get fast and reliable session loading.
- Users see live updates without manual refresh.
- Users trust that mobile reflects desktop truth in near real-time.

### Phase 2: Messaging and Streaming Core

Work:

1. Add `sendMessage`, `interrupt`, and `killShell` endpoints.
2. Stream `text_delta`, `tool_*`, `status`, `complete`, `error`.
3. Port reducer semantics from renderer event processor to shared mobile reducer.
4. Add optimistic user message handling and queued message behavior.

User narrative:

- Users can continue active agent work from iPhone without waiting for desktop access.
- Users get the same streaming feel and task visibility they expect from desktop.

### Phase 3: Pairing, Security, and Network Hardening

Work:

1. Implement pairing code flow and token issuance.
2. Store token in iOS Keychain.
3. Add token expiration, refresh/re-pair, revoke-device endpoint.
4. Restrict bind/allowlist for local + Tailscale usage.

User narrative:

- Users can safely access their agent runtime from phone without exposing it publicly.
- Users recover quickly from expired sessions instead of getting stuck.

### Phase 4: Mobile App Shell and Navigation

Work:

1. Scaffold Expo app with route structure.
2. Build session list screen and chat screen shell.
3. Implement drawer/bottom-sheet session navigation.
4. Add reconnect states and offline banners.

User narrative:

- Users can find and resume conversations quickly on phone.
- Users understand connection status at a glance and avoid silent failure states.

### Phase 5: Design System and Theme Parity

Work:

1. Build `packages/mobile-tokens`.
2. Build `packages/mobile-ui` primitives with desktop-equivalent variants.
3. Implement theme resolver with workspace override support.
4. Apply typography/spacing/radius parity to chat and list surfaces.

User narrative:

- Users experience a familiar interface that feels like Orchestra, not a generic mobile client.
- Users keep visual continuity when switching between desktop and iPhone.

### Phase 6: Attachments and Interaction Completeness

Work:

1. Implement photo/document pickers.
2. Add attachment upload API integration with progress + retry.
3. Add permission/credential request cards for interactive approvals.
4. Add tool activity timeline and error detail expansion.

User narrative:

- Users can provide context from mobile files/camera and unblock agent tasks immediately.
- Users can resolve auth/permission prompts directly from iPhone.

### Phase 7: QA, Performance, and Release

Work:

1. Contract tests for gateway serialization and event streams.
2. Reducer parity tests against desktop event fixtures.
3. iOS E2E (pair -> stream -> interrupt -> resume).
4. TestFlight rollout with telemetry for reconnect/errors/latency.

User narrative:

- Users get a stable mobile experience with predictable behavior in real-world network conditions.
- Users see faster iteration on production issues via staged rollout.

## Acceptance Criteria (MVP)

1. A user can pair iPhone with Mac-hosted runtime in under 2 minutes.
2. A user can list and open sessions with complete history.
3. A user can send a message and see live streaming output + tool activity.
4. A user can interrupt running work and recover cleanly.
5. A user can upload at least image + PDF attachments from iOS.
6. Theme/colors match existing Orchestra design language using shared token semantics.
7. Reconnect behavior handles temporary network loss without app restart.

## Risks and Mitigations

1. Risk: Contract drift between desktop and mobile.
   - Mitigation: shared `mobile-contracts` package + fixture-based parity tests.
2. Risk: SSE instability over network transitions.
   - Mitigation: heartbeat + resume cursor + exponential backoff reconnect.
3. Risk: UI inconsistency vs desktop design.
   - Mitigation: token-first mobile package + explicit primitive variant mapping.
4. Risk: Scope bloat from desktop parity expectations.
   - Mitigation: freeze MVP surface and defer non-core commands/events.

## Recommended Timeline

- Week 1-2: Phase 1
- Week 3-4: Phase 2
- Week 5: Phase 3
- Week 6: Phase 4
- Week 7: Phase 5
- Week 8: Phase 6 + Phase 7 start

## Immediate Next Actions

1. Create `packages/mobile-contracts` and lock event/DTO schema.
2. Implement Electron mobile gateway skeleton + health/pair/session list endpoints.
3. Scaffold `apps/mobile` with Expo + route shell + SSE client.
4. Create `packages/mobile-tokens` from existing theme sources.

## Finish Plan (Execution Order)

### Step 1: Wire Mobile Gateway Into Electron Runtime

Status: Completed on 2026-03-02.

Work:

1. Added gateway bootstrap/lifecycle in Electron main process startup/shutdown.
2. Bridged SessionManager events into gateway SSE broadcaster.
3. Added config for bind host/port and local-network safety defaults.
4. Added health diagnostics in Electron logs to confirm gateway availability.

User narrative:

- Users can actually pair a phone to the running Mac app and trust that live session state is real.

### Step 2: Implement Real Onboarding and Pairing Screens

Status: Completed on 2026-03-02.

Work:

1. Replaced onboarding placeholder route with `welcome`, `find-runtime`, `confirm-pair`, `pair-success`.
2. Connected pair flow to `/api/pair/start`, `/api/pair/confirm`, and refresh logic.
3. Added pairing error states (invalid code, expired code, unreachable host).
4. Persisted host and device context for reconnect/resume.
5. Kept onboarding implementation on existing mobile design primitives (`Button`, `TextInput`) and theme tokens.

User narrative:

- Users can get from install to active session on phone in a few taps without setup confusion.

### Step 3: Build Sessions Home End-to-End

Status: Completed on 2026-03-02.

Work:

1. Implemented sessions list screen using existing stores/API methods.
2. Added pull-to-refresh, unread indicators, status badges, and relative timestamps.
3. Added swipe + long-press actions (`markRead`, `markUnread`, `rename`, `status`, `permission mode`, `delete`) with command wiring to existing gateway endpoints.
4. Added empty/offline/loading states from UX spec.
5. Added a minimal session route target so session taps are functional while Step 4 chat UI is built.
6. Kept implementation on existing mobile primitives/tokens (`Button`, `Badge`, `ConnectionChip`, theme provider).

User narrative:

- Users can quickly triage and reopen the right conversation instead of hunting through desktop first.

### Step 4: Build Chat Screen With Streaming and Controls

Status: Completed on 2026-03-02.

Work:

1. Implemented chat route per session and load of message history.
2. Rendered streaming assistant output and tool/status/error events from reducer state.
3. Implemented composer send + interrupt toggle and reconnect-safe pending-send replay queue.
4. Added jump-to-live behavior and bottom-lock rules during streaming.
5. Added session header action menu (rename/status/permission mode/delete) using existing command endpoints.

User narrative:

- Users can confidently continue active agent work from iPhone, including stopping runs when needed.

### Step 5: Complete Attachments and Interactive Requests

Work:

1. Add camera/photo/files picker integration.
2. Implement upload staging/progress/retry/cancel UI tied to attachment endpoint.
3. Render permission and credential request cards with approve/deny/submit actions.
4. Ensure pending approvals survive app background/foreground transitions.

User narrative:

- Users can unblock agent tasks from mobile instantly instead of waiting to return to desktop.

### Step 6: Ship Settings, Diagnostics, and Re-Pair UX

Work:

1. Add runtime settings screen with host info, sync timestamp, and unpair flow.
2. Add appearance selector (system/light/dark) tied to theme provider.
3. Add diagnostics bundle copy (versions, SSE state, last error).
4. Add full-screen re-pair recovery when token is invalid/expired.

User narrative:

- Users can self-recover connectivity and auth issues without losing trust in the app.

### Step 7: Stabilize With E2E + Beta Rollout

Work:

1. Add happy-path and failure-path iOS E2E (pair -> sessions -> chat stream -> interrupt -> resume).
2. Add regression tests for reconnect, pending-send replay, and permission card flows.
3. Add TestFlight distribution checklist and telemetry dashboard for reconnect/error rates.
4. Run staged beta with known power users and close top blockers before broad rollout.

User narrative:

- Users get a dependable daily driver experience rather than a demo that fails under real network conditions.
