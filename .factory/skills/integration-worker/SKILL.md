---
name: integration-worker
description: Handles Electron integration, parity tests, and contract compliance testing
---

# Integration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- Wiring `packages/mobile-gateway` into `apps/electron/src/main/`
- Contract parity tests (DTO serialization matches types)
- Reducer parity tests (mobile event processor matches desktop)
- End-to-end test scenarios
- Cross-package integration verification

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps. Check `{missionDir}/AGENTS.md` for boundaries — especially the Electron modification restriction (only allowed in Milestone 6). Check `.factory/library/` for architecture patterns.

### 2. Check Preconditions

Verify:
- Required packages are built and their tests pass
- For Electron integration: `packages/mobile-gateway` exports `createGatewayServer`
- For parity tests: both desktop and mobile event processors are accessible
- For contract tests: `packages/mobile-contracts` has DTOs and `packages/mobile-gateway` has serializers

If preconditions are NOT met, return to orchestrator.

### 3. Write Tests First (RED)

**Contract parity tests:**
- Create test fixtures from `apps/electron/src/shared/types.ts` event types
- Verify gateway serializers produce DTOs matching `mobile-contracts` schemas
- Test every DTO field type, optional handling, enum values

**Reducer parity tests:**
- Extract event sequences from desktop test fixtures or create representative sequences
- Run same sequence through mobile event processor
- Compare resulting state (message order, content, tool status, permissions, session metadata)

**Electron integration tests:**
- Verify `createGatewayServer` can be imported and started
- Verify gateway accepts a SessionManager-compatible interface
- Verify lifecycle (start/stop without orphaned processes)

Use `bun test` for all integration tests.

### 4. Implement (GREEN)

**For Electron integration:**
- Add `mobile-gateway` to `apps/electron/package.json` dependencies
- Create `apps/electron/src/main/mobile-gateway/index.ts` that:
  - Imports `createGatewayServer` from `@craft-agent/mobile-gateway`
  - Creates adapter wrapping `SessionManager` to match gateway interface
  - Starts gateway on configured port during app initialization
  - Stops gateway on app shutdown
- Wire into `apps/electron/src/main/index.ts` initialization flow

**For parity tests:**
- Build comprehensive event fixtures covering all MVP event types
- Create comparison utilities that normalize state for comparison
- Test critical paths: streaming, tool execution, permissions, session lifecycle

### 5. Run All Tests (GREEN)

```bash
# Integration/parity tests
bun test packages/mobile-gateway/src/__tests__/integration/
bun test packages/mobile-gateway/src/__tests__/parity/

# Ensure existing packages still pass
cd packages/mobile-gateway && bun test
cd packages/mobile-contracts && bun test
cd apps/mobile && npx jest
```

### 6. TypeScript Check

```bash
cd apps/electron && bun run tsc --noEmit  # if Electron modified
cd packages/mobile-gateway && bun run tsc --noEmit
```

### 7. Manual Verification

For Electron integration, verify the gateway starts and responds:
- Check that imports resolve correctly
- Verify adapter correctly translates between SessionManager and gateway interface

For parity, review test coverage and edge cases.

## Example Handoff

```json
{
  "salientSummary": "Created reducer parity test suite with 8 event sequence fixtures. All produce identical state between desktop event processor and mobile event processor. Contract tests verify all 14 DTO types serialize correctly from internal types.",
  "whatWasImplemented": "Parity test suite at packages/mobile-gateway/src/__tests__/parity/ with 8 fixtures covering: streaming text, tool execution, permission flow, session creation/deletion, error handling, interrupt, mixed sequence. Contract tests at packages/mobile-gateway/src/__tests__/contract/ validating all DTO serializations.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "bun test packages/mobile-gateway/src/__tests__/parity/", "exitCode": 0, "observation": "8 parity fixtures, all produce matching state snapshots" },
      { "command": "bun test packages/mobile-gateway/src/__tests__/contract/", "exitCode": 0, "observation": "14 DTO contract tests pass" },
      { "command": "cd packages/mobile-gateway && bun run tsc --noEmit", "exitCode": 0, "observation": "Clean" }
    ],
    "interactiveChecks": [
      { "action": "Reviewed streaming parity fixture", "observed": "3 text_delta + text_complete produces identical message state in both processors" },
      { "action": "Reviewed tool execution fixture", "observed": "tool_start + tool_result with nested parentToolUseId correctly handled by both" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "packages/mobile-gateway/src/__tests__/parity/streaming.test.ts",
        "cases": [
          { "name": "text streaming produces identical state", "verifies": "Desktop and mobile processors produce same messages from text_delta sequence" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Desktop event processor has behaviors not documented in types
- SessionManager API doesn't match expected interface and adapter can't bridge the gap
- Electron build pipeline doesn't support the new dependency
- Parity tests reveal fundamental architectural differences requiring redesign
