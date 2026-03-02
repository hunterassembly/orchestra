# User Testing

Testing surface, tools, URLs, setup steps, and known quirks.

**What belongs here:** How to test the app manually, testing tool details, URLs, credentials, isolation notes.

---

## Testing Surface

### Gateway Endpoints (curl-testable)
- Start gateway: `cd packages/mobile-gateway && PORT=7842 bun run src/test-server.ts`
- Health: `curl http://localhost:7842/api/health`
- Authenticated: `curl -H "Authorization: Bearer <token>" http://localhost:7842/api/workspaces`
- SSE: `curl -N -H "Authorization: Bearer <token>" http://localhost:7842/api/workspaces/<id>/events`

### Mobile App (component-testable only)
- No iOS simulator available
- Test via: `cd apps/mobile && npx jest`
- TypeScript: `cd apps/mobile && npx tsc --noEmit`
- Component tests use @testing-library/react-native

## Accepted Limitations
- No visual/interactive mobile testing (no simulator)
- No actual SSE testing in RN context (mocked)
- No native module testing (secure store, camera, file picker — mocked)
- Haptics and animations cannot be visually verified

## Testing Strategy
1. Gateway: Start test server, curl endpoints, verify responses
2. Contracts/tokens: bun test for type/value correctness
3. Mobile stores: Jest unit tests for state management
4. Mobile components: Jest + RTL for rendering and interaction
5. Integration: bun test for parity and contract compliance

## Flow Validator Guidance: Gateway API (curl)

**Server URL:** http://localhost:7842  
**Auth token:** Any string works as Bearer token in test server (e.g., `Bearer test-token`)  
**Default workspace ID:** `default`  
**Default workspace name:** `Default Workspace`

### Isolation Rules
- Each subagent should use unique session names prefixed with their group ID (e.g., `group1-session-1`)
- The test server's mock session manager creates sessions with auto-incrementing IDs (`session-1`, `session-2`, etc.) — these are global across subagents
- SSE connections are workspace-scoped, so subagents testing SSE should use the same `default` workspace but only verify events for their own sessions
- Do NOT delete sessions created by other subagents

### How to test
- Use `curl` for all REST endpoint testing
- Use `-s` for silent mode, `-w "\nHTTP %{http_code}\n"` to capture status codes
- Use `-H "Authorization: Bearer test-token"` for authenticated endpoints
- Use `-H "Content-Type: application/json"` with `-d '{...}'` for POST bodies
- For SSE: use `curl -N -s -H "Authorization: Bearer test-token" <url>` with background process + timeout
- Parse JSON responses with `python3 -m json.tool` or `python3 -c "import json,sys; ..."`

### Writing flow reports
Write JSON report to: `.factory/validation/contracts-gateway-foundation/user-testing/flows/<group-id>.json`

Report format:
```json
{
  "groupId": "<group-id>",
  "assertions": {
    "VAL-GW-XXX": {
      "status": "pass" | "fail" | "blocked",
      "evidence": "Description of what was observed",
      "details": "Specific curl output or error"
    }
  },
  "frictions": [],
  "blockers": [],
  "toolsUsed": ["curl", "python3"]
}
```
