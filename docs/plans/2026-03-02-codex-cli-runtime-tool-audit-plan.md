# Codex CLI Runtime Integration Plan (With Full Tool Audit)

## Goal

Add a first-class `Codex CLI` backend to Orchestra while keeping the current `Claude` backend available, so users can choose:

- `Orchestra + Codex CLI` for full Codex-native workflows
- `Orchestra + Claude` for Claude-model workflows

This plan is implementation-focused and tool-audit-driven so no tool surface is missed.

## Current State Audit

### Backend/runtime state

- Active backends today: `anthropic` (`ClaudeAgent`) and `pi` (`PiAgent`).
- `CodexAgent` is not present in the repo today.
- Runtime plumbing already anticipates external backends:
  - `EventQueue` + async adapter pattern exists.
  - `McpPoolServer` exists for subprocess backends that need HTTP access to centralized source tools.
  - `applyBridgeUpdates()` and backend capability flags are already in place.
- Packaging already includes `vendor/codex/**/*` and `resources/bridge-mcp-server/**/*`, but there is no active Codex backend wiring.

### Tool execution architecture today

- Tool gatekeeping is centralized in `runPreToolUseChecks()`:
  - permission mode gating
  - inactive source gating
  - prerequisite checks
  - `call_llm`/`spawn_session` interception
  - ask-mode permission prompts
- Session-scoped tool definitions are canonical in `session-tools-core` and consumed by both:
  - `session-mcp-server` subprocess path
  - in-process `session-scoped-tools` path
- Source/API tools are centralized through `McpClientPool`, exposed as proxy tool names.

## Full Tool Audit and Codex Coverage Requirements

### 1) Native SDK Tool Family

Audited tool set in `BUILT_IN_TOOLS`:

- `Bash`
- `Read`
- `Write`
- `Edit`
- `Glob`
- `Grep`
- `WebFetch`
- `WebSearch`
- `Task`
- `TaskOutput`
- `TodoWrite`
- `MultiEdit`
- `NotebookEdit`
- `KillShell`
- `SubmitPlan`
- `Skill`
- `SlashCommand`
- `TaskStop`

Codex integration requirements:

- Preserve centralized `PreToolUse` behavior for all native tools.
- Preserve permission prompt semantics (`bash`, `file_write`) and per-session whitelists.
- Preserve interruption/redirect behavior and queued-message semantics.
- Preserve background task/shell event compatibility (`task_backgrounded`, `shell_backgrounded`, `task_progress`, `shell_killed`).

### 2) Session MCP Tool Family

Canonical session tools (audited from `SESSION_TOOL_DEFS`):

- `SubmitPlan`
- `config_validate`
- `skill_validate`
- `mermaid_validate`
- `source_test`
- `source_oauth_trigger`
- `source_google_oauth_trigger`
- `source_slack_oauth_trigger`
- `source_microsoft_oauth_trigger`
- `source_credential_prompt`
- `update_user_preferences`
- `transform_data`
- `render_template`
- `call_llm`
- `spawn_session`

Codex integration requirements:

- Route all session tools through canonical registry/handlers (no backend-specific forks except approved `call_llm`/`spawn_session` execution path).
- Keep callback parity for:
  - plan submission (`plan_submitted`)
  - auth request (`auth_request`, `auth_completed`)
  - credential prompt path
  - source activation flow
- Keep `call_llm` and `spawn_session` pre-execution/intercept logic shared via `BaseAgent`.

### 3) Source MCP and API Tool Family

Audited surfaces:

- MCP proxy naming currently supported:
  - `mcp__{slug}__{tool}` (pool-connected sources)
  - `mcp__sources__{slug}__{tool}` (external-process bridge conventions)
- API-generated tools:
  - `api_{sourceName}` at source-server level
  - proxied via MCP pool as source tools

Codex integration requirements:

- Codex backend must consume the same centralized pool tool inventory as other backends.
- Ensure naming normalization in event adapters so UI display metadata resolves source/tool icon/name correctly.
- Preserve large-response handling and summarization path for MCP/API results.

### 4) Docs Tool Family

Audited surfaces:

- `craft-agents-docs` MCP server is exposed for docs search tools.

Codex integration requirements:

- Keep docs server always available in Codex sessions.
- Keep mode-manager semantics that treat docs tools as read-only.

### 5) Automations Hook Family

Audited hooks/events in runtime flow:

- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`

Codex integration requirements:

- Ensure Codex backend emits the same hook lifecycle with equivalent payload fields.
- Ensure hook failures remain non-fatal to agent execution.

### 6) Session/IPC/Event Contract Family

Audited event contract includes:

- text/tool lifecycle: `text_delta`, `text_complete`, `tool_start`, `tool_result`, `complete`
- control/status: `interrupted`, `status`, `info`, `error`, `typed_error`
- permissions/auth: `permission_request`, `credential_request`, `auth_request`, `auth_completed`
- plan/source/session: `plan_submitted`, `source_activated`, `sources_changed`, `connection_changed`
- background execution: `task_backgrounded`, `shell_backgrounded`, `task_progress`, `shell_killed`

Codex integration requirements:

- Preserve existing session event/message parity test guarantees.
- Preserve parent/child tool tracking semantics for subagent/task trees.
- Preserve session recovery behavior on resume failure.

### 7) Attachments and File Pipelines

Audited surfaces:

- Attachment ingest/storage and markdown conversion in Electron main IPC.
- Send path supports in-memory + stored attachments.
- `spawn_session` supports validated attachment path ingestion.
- `call_llm` builder enforces text-file constraints for attachment payloads.

Codex integration requirements:

- Keep same attachment rules and security checks.
- Keep same behavior for markdown-converted office files, thumbnails, and stored file references.

## Implementation Plan

Each step includes explicit user narrative.

### Phase 1: Codex Backend Foundation

1. Add `codex` as a real backend provider in backend types/factory/driver registry.
User narrative: Users get an explicit, reliable runtime choice instead of implicit rerouting through another backend.

2. Implement `CodexAgent` using the existing async subprocess/event-queue architecture.
User narrative: Streaming behavior feels identical to existing sessions, so switching runtime does not break UX expectations.

3. Introduce a Codex runtime driver in backend internals and host runtime resolution.
User narrative: Codex sessions start predictably in dev and packaged builds without manual path hacks.

### Phase 2: Tool Parity Layer

1. Plug Codex backend into shared `runPreToolUseChecks()` pipeline.
User narrative: Permission prompts, safety constraints, and source activation behave consistently regardless of model/runtime choice.

2. Wire native tool events from Codex into canonical `AgentEvent` format via a Codex event adapter.
User narrative: Timeline cards, tool icons, and status transitions remain familiar and trustworthy.

3. Preserve ask-mode prompt behavior and session whitelists for `bash`, `file_write`, MCP/API mutation categories.
User narrative: Approval UX stays predictable and safe; users never lose control when switching runtimes.

### Phase 3: Session Tool and Source Tool Integration

1. Route session tools through canonical `session-tools-core` definitions for Codex sessions.
User narrative: Planning, source setup, and preference-update workflows work the same in Codex and Claude sessions.

2. Connect Codex backend to centralized `McpClientPool` (direct or via `McpPoolServer` depending on runtime topology).
User narrative: Existing sources continue to work immediately in Codex sessions without separate configuration.

3. Ensure `call_llm` and `spawn_session` intercept paths are preserved for Codex.
User narrative: Multi-step orchestration and sub-session workflows continue to work in Codex sessions.

### Phase 4: Auth, Connection Model, and UX Surfaces

1. Add a first-class connection template for Codex runtime (distinct from existing Pi/OpenAI mapping).
User narrative: Users can intentionally choose true Codex runtime instead of guessing from provider names.

2. Keep existing Claude connection flows unchanged and selectable side-by-side.
User narrative: Users can use Codex when they want autonomy and Claude when they want Claude-model behavior, in one app.

3. Ensure auth callbacks/errors are mapped to existing renderer events and onboarding flows.
User narrative: Login/re-auth feels identical and understandable across runtime choices.

### Phase 5: Hardening and Rollout

1. Add Codex parity tests mirroring existing session-event/message parity suites.
User narrative: Tool and timeline behavior remains stable after runtime changes.

2. Add end-to-end tests for permission prompts, auth requests, source activation, background task handling, and interruption recovery on Codex.
User narrative: Fewer runtime-specific edge-case failures during real usage.

3. Launch behind a feature flag, then graduate to general availability after telemetry/error thresholds pass.
User narrative: Early adopters can use Codex quickly while production stability is protected.

## File/Module Implementation Map

- Backend factory and provider mapping:
  - `packages/shared/src/agent/backend/factory.ts`
  - `packages/shared/src/agent/backend/types.ts`
  - `packages/shared/src/agent/backend/internal/driver-types.ts`
  - `packages/shared/src/agent/backend/internal/runtime-resolver.ts`
- New backend implementation:
  - `packages/shared/src/agent/codex-agent.ts` (new)
  - `packages/shared/src/agent/backend/codex/*` (new adapter/helpers)
- Tool/event parity and shared logic touchpoints:
  - `packages/shared/src/agent/core/pre-tool-use.ts`
  - `packages/shared/src/agent/base-agent.ts`
  - `packages/shared/src/mcp/mcp-pool.ts`
  - `packages/shared/src/mcp/pool-server.ts`
  - `packages/session-tools-core/src/tool-defs.ts`
  - `packages/session-mcp-server/src/index.ts`
- Session orchestration and UI event path:
  - `apps/electron/src/main/sessions.ts`
  - `apps/electron/src/shared/types.ts`
- Connection setup and config migration:
  - `apps/electron/src/main/connection-setup-logic.ts`
  - `packages/shared/src/config/llm-connections.ts`
  - `packages/shared/src/config/storage.ts`

## Acceptance Checklist (Tool Coverage)

- Native tool execution parity (all audited native tools).
- Session tool parity (all 15 canonical session tools).
- Source/API tool parity via centralized pool.
- Docs tools available in Codex sessions.
- Permission/auth/credential flows parity.
- Background task and shell event parity.
- Attachment pipeline parity for message sends and `spawn_session`.
- Automation hook parity.
- Session event/message parity test suite green for Codex.

## Risks and Mitigations

- Risk: Tool-name normalization drift (`mcp__sources__...` vs `mcp__{slug}__...`).
Mitigation: codify canonical mapping in Codex adapter tests + display-meta tests.

- Risk: Runtime/auth confusion between Pi OpenAI path and true Codex runtime.
Mitigation: explicit connection labels and migration UI copy separating “Codex Runtime” vs “Pi/OpenAI”.

- Risk: Missing bridge server source (only bundled artifact present).
Mitigation: prefer centralized `McpPoolServer` path and avoid new hidden runtime dependencies where possible.

## Recommended Rollout Strategy

1. Internal-only feature flag for Codex backend.
2. Dogfood with real source-heavy workflows (Linear/GitHub/Gmail) and long-running tasks.
3. Enable for selected users with telemetry gates.
4. Make Codex runtime a normal connection option after parity checklist is fully green.

## Codex Upgrade Playbook

Purpose: Keep Orchestra stable while staying current with Codex CLI releases.

### Versioning Strategy

1. Pin a known-good Codex CLI version for `stable` releases.
User narrative: users get predictable behavior and fewer surprise regressions.

2. Track a `candidate` Codex CLI version in `orchestra-dev`.
User narrative: new capabilities can be validated early without destabilizing daily use.

3. Keep one-step rollback to previous pinned version (binary + config manifest).
User narrative: if an upgrade breaks flows, users can recover quickly.

### Compatibility Architecture Rules

1. Keep all Codex protocol mapping in a thin adapter boundary (events, tool names, metadata normalization).
User narrative: backend upgrades are isolated and less likely to break visible UX.

2. Use tolerant parsing for unknown fields and feature detection for optional capabilities.
User narrative: minor upstream protocol changes degrade gracefully instead of hard-failing.

3. Avoid distributing Codex-specific assumptions across session manager/UI code.
User narrative: feature behavior remains consistent across backend choices.

### CI Gates Per Codex Upgrade

1. Run contract tests against recorded Codex transcripts for:
   - `tool_start` / `tool_result`
   - permission prompts
   - interrupt/redirect
   - background tasks/shells
   - source activation/auth callbacks
   - subagent parent/child tracking
User narrative: critical interactive flows remain intact after each upgrade.

2. Run session event/message parity suites and mode-manager permission tests.
User narrative: timeline rendering and approval UX stay trustworthy.

3. Run smoke E2E in `orchestra-dev` with real source mixes (MCP + API + docs tools).
User narrative: practical workflows are validated, not just unit-level logic.

4. Block promotion unless all gates pass on both:
   - currently pinned version
   - new candidate version
User narrative: no regressions are introduced while adopting new Codex features.

### Promotion Workflow

1. Open upgrade PR with:
   - version bump
   - changelog summary
   - protocol diffs (if any)
   - contract fixture updates (if required)
User narrative: changes are transparent and reviewable.

2. Deploy to internal canary users first.
User narrative: issues are caught before broad rollout.

3. Promote to stable only after:
   - canary error rate threshold is met
   - no critical workflow regressions
   - rollback path verified
User narrative: production updates happen only when reliability is confirmed.

### Runtime Guardrails

1. Startup compatibility check (required capabilities + protocol sanity).
User narrative: incompatible builds fail fast with clear action, not mid-session.

2. Circuit breaker/kill switch to disable candidate and force pinned fallback.
User narrative: recovery is immediate if upstream changes cause runtime instability.

3. Structured telemetry around tool/event parse failures and unknown message shapes.
User narrative: issues can be diagnosed and fixed quickly.

### Ownership and Cadence

1. Assign a backend owner for Codex upgrade readiness and release signoff.
User narrative: accountability improves response time and quality.

2. Run a recurring upgrade cycle (e.g., biweekly) instead of ad hoc updates.
User narrative: users receive improvements regularly without chaotic regressions.

3. Keep a live “known issues by Codex version” matrix in docs.
User narrative: support and troubleshooting are faster and clearer.
