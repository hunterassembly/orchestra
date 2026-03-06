# Orchestra Upstream Integration Plan

## Goal

Integrate `upstream/main` (`v0.7.0` and `v0.7.1`) into Orchestra without losing fork-specific behavior, especially:

- Orchestra branding and dev/prod path isolation
- Local Whisper push-to-talk
- Vault notes/tasks and related editor flows
- Chat tab workflows and panel UX
- Mobile gateway integration

## Current State

- Local `main` is aligned with `origin/main`.
- `upstream/main` introduces a major transport refactor from Electron IPC/preload wiring to a WS/RPC handler architecture.
- A direct merge conflicts in main-process transport files, renderer navigation/editor files, and a few shared config/auth/runtime files.
- The risk is not merge syntax; the risk is silently dropping Orchestra-specific behavior during the upstream architecture transition.

## Integration Strategy

### 1. Land the upstream transport shape first

- Merge `upstream/main` on an integration branch.
- Resolve core architecture conflicts in favor of the upstream WS/RPC structure.
- Reattach Orchestra-only runtime behaviors onto the new structure rather than preserving the old IPC path.

User narrative: this keeps the app on the upstream foundation users will continue receiving fixes on, instead of trapping Orchestra on a dead transport path.

### 2. Port Orchestra runtime features onto the new backend entrypoints

- Reconcile Electron startup/runtime wiring in `apps/electron/src/main/index.ts`.
- Port custom behaviors that upstream does not know about:
  - app naming and isolated config paths
  - mobile gateway startup/shutdown
  - local Whisper hooks
  - any custom preload-exposed capabilities still needed by the renderer

User narrative: users keep the Orchestra-specific workflows they rely on, even after the upstream engine swap underneath them.

### 3. Reconcile shared auth/config/runtime edge cases

- Merge `chatgpt-oauth`, storage migrations, backend runtime payload fields, privileged execution logging, and prerequisite-manager changes.
- Prefer combinations that preserve Orchestra path isolation and provider-specific fixes while matching upstream protocol expectations.

User narrative: connection setup, auth refresh, and packaged-runtime behavior stay stable instead of regressing after the merge.

### 4. Reapply Orchestra renderer/editor UX on top of upstream UI changes

- Resolve renderer conflicts by preserving Orchestra UX where it is intentional:
  - tabbed chat/workflow/file panels
  - notes/tasks navigation
  - push-to-talk input behavior
  - settings behavior
- Accept upstream UI changes where they are part of the new architecture and do not conflict with Orchestra product choices.

User narrative: users get upstream fixes without losing the workflows and interface patterns that make Orchestra distinct.

### 5. Verify before considering merge-ready

- Run targeted tests for shared/runtime and affected Electron/renderer areas.
- Run at least one build/typecheck pass that exercises the new integration path.
- Record any remaining gaps or manual follow-ups.

User narrative: users get a branch that is meaningfully integrated and checked, not a nominal merge commit that hides runtime breakage.

## Conflict Areas To Resolve

- `apps/electron/src/main/index.ts`
- `apps/electron/src/main/ipc.ts`
- `apps/electron/src/preload/index.ts`
- `packages/server-core/src/sessions/SessionManager.ts`
- `packages/shared/src/config/storage.ts`
- `packages/shared/src/auth/chatgpt-oauth.ts`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `apps/electron/src/renderer/contexts/NavigationContext.tsx`
- `apps/electron/src/renderer/pages/ChatPage.tsx`
- `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx`

## Decision Log

- Use a dedicated integration branch instead of modifying `main` directly.
- Prefer upstream architecture in transport-layer conflicts.
- Re-port Orchestra-specific product behavior explicitly rather than preserving obsolete IPC wiring.

## Verification Targets

- Merge completes with no unresolved conflicts.
- Typecheck/build succeeds for affected packages/apps.
- Key workflows still have code paths after the port:
  - app startup
  - session transport
  - notes/task editor routing
  - push-to-talk
  - mobile gateway lifecycle
  - AI settings re-auth flow
