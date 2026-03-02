---
name: gateway-worker
description: Builds mobile gateway server, contracts, and authentication packages
---

# Gateway Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that involve:
- `packages/mobile-contracts` (DTOs, event types, serialization schemas)
- `packages/mobile-gateway` (HTTP server, routes, SSE, auth middleware)
- Gateway endpoint implementation
- Pairing and token authentication
- DTO serialization and validation

## Work Procedure

### 1. Understand the Feature

Read the feature description, preconditions, expectedBehavior, and verificationSteps carefully. Check `{missionDir}/AGENTS.md` for conventions and boundaries. Check `.factory/library/` for any relevant existing knowledge about the gateway architecture or API contracts.

### 2. Check Preconditions

Verify all preconditions are met:
- Required packages exist and have correct structure
- Dependencies are installed (`bun install` if needed)
- Any prerequisite features are complete (check code exists)

If preconditions are NOT met, return to orchestrator.

### 3. Write Tests First (RED)

Before implementing anything, write failing tests:
- For HTTP endpoints: test request/response behavior (status codes, response shapes, error cases)
- For serialization: test DTO output matches contract types
- For auth: test token validation, rejection of invalid/expired tokens
- For SSE: test connection setup, event delivery, heartbeat

Tests go in `__tests__/` directories adjacent to source files. Use `bun test`.

Run the tests to confirm they FAIL (red phase).

### 4. Implement (GREEN)

Implement the minimum code to make tests pass:
- Gateway routes use `node:http` (no frameworks)
- Serializers in dedicated files converting internal types to DTOs from `mobile-contracts`
- Auth middleware checks Bearer token and returns 401 if invalid
- SSE uses `text/event-stream` content type with proper headers
- All route handlers follow pattern: parse request → validate → call session manager → serialize response

### 5. Run All Tests (GREEN)

```bash
cd packages/mobile-gateway && bun test
cd packages/mobile-contracts && bun test
```

ALL tests must pass.

### 6. TypeScript Check

```bash
cd packages/mobile-gateway && bun run tsc --noEmit
cd packages/mobile-contracts && bun run tsc --noEmit
```

Must pass with zero errors.

### 7. Manual Verification

Start the gateway test server and verify key behaviors with curl:

```bash
# Start test server (background)
cd packages/mobile-gateway && bun run src/test-server.ts &

# Test health
curl -s http://localhost:7842/api/health

# Test with auth
curl -s -H "Authorization: Bearer test-token" http://localhost:7842/api/workspaces

# Test SSE (observe for a few seconds)
curl -s -N -H "Authorization: Bearer test-token" http://localhost:7842/api/workspaces/default/events

# Stop test server
kill %1
```

Record each verification in `interactiveChecks`.

### 8. Clean Up

Stop any test servers. Ensure no processes left running on port 7842.

## Example Handoff

```json
{
  "salientSummary": "Implemented session CRUD endpoints (GET/POST/DELETE) with auth middleware. Wrote 12 tests covering success, 404, 401, and validation cases. All pass. Verified with curl: GET /sessions returns correct DTOs, POST creates session, DELETE removes it. SSE emits session_created/deleted events.",
  "whatWasImplemented": "Session CRUD routes in packages/mobile-gateway/src/routes/sessions.ts with SessionDTO serializer. Auth middleware validates Bearer tokens. Tests cover all status codes and edge cases.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd packages/mobile-gateway && bun test", "exitCode": 0, "observation": "12 tests passed, 0 failed" },
      { "command": "cd packages/mobile-gateway && bun run tsc --noEmit", "exitCode": 0, "observation": "No type errors" },
      { "command": "cd packages/mobile-contracts && bun run tsc --noEmit", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": [
      { "action": "curl GET /api/workspaces/default/sessions with valid token", "observed": "200 with JSON array of 3 SessionDTOs, each with id/name/lastMessageAt/isProcessing fields" },
      { "action": "curl POST /api/workspaces/default/sessions with valid token", "observed": "201 with new SessionDTO, id is UUID format" },
      { "action": "curl DELETE /api/sessions/test-id with valid token", "observed": "204 empty response" },
      { "action": "curl GET /api/sessions/nonexistent with valid token", "observed": "404 with error body" },
      { "action": "curl GET /api/workspaces/default/sessions without token", "observed": "401 Unauthorized" }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "packages/mobile-gateway/src/routes/__tests__/sessions.test.ts",
        "cases": [
          { "name": "GET /sessions returns session list", "verifies": "Session list endpoint returns array of SessionDTOs" },
          { "name": "POST /sessions creates new session", "verifies": "Create endpoint returns new session with correct fields" },
          { "name": "DELETE /sessions/:id removes session", "verifies": "Delete endpoint returns 204 and session is gone" },
          { "name": "GET /sessions requires auth", "verifies": "Missing token returns 401" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- SessionManager interface doesn't support a required operation
- Existing type definitions in `apps/electron/src/shared/types.ts` are ambiguous
- Port 7842 is already in use and cannot be freed
- A dependency on another package that doesn't exist yet
