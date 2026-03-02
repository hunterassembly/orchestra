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
**Auth token:** Use `Bearer test-token` (pre-seeded) or pair via POST /api/pair/start + /api/pair/confirm to get a valid token. The test server validates tokens — arbitrary strings are rejected.  
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

## Flow Validator Guidance: Gateway Messaging Auth (curl)

**Server URL:** http://localhost:7842
**Auth token:** Use `Bearer test-token` (pre-seeded legacy token). For auth-specific testing that needs real tokens, use the pairing flow: POST /api/pair/start + POST /api/pair/confirm.
**Default workspace ID:** `default`
**Default workspace name:** `Default Workspace`
**Seeded session:** `seeded-session-1` (has 2 messages, workspace=`default`)

### How to obtain a real auth token (pairing flow)
```bash
PAIR=$(curl -sf -X POST http://localhost:7842/api/pair/start)
PAIRING_ID=$(echo "$PAIR" | python3 -c "import json,sys; print(json.load(sys.stdin)['pairingId'])")
CODE=$(echo "$PAIR" | python3 -c "import json,sys; print(json.load(sys.stdin)['code'])")
CONFIRM=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d "{\"pairingId\": \"$PAIRING_ID\", \"code\": \"$CODE\"}" \
  http://localhost:7842/api/pair/confirm)
ACCESS_TOKEN=$(echo "$CONFIRM" | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
REFRESH_TOKEN=$(echo "$CONFIRM" | python3 -c "import json,sys; print(json.load(sys.stdin)['refreshToken'])")
DEVICE_ID=$(echo "$CONFIRM" | python3 -c "import json,sys; print(json.load(sys.stdin)['deviceId'])")
```

### Isolation Rules for gateway-messaging-auth
- Each subagent should create their own sessions using unique names prefixed with group ID
- Session IDs are auto-generated (`session-1`, `session-2`, etc.) — each subagent creates fresh sessions
- For auth testing, each subagent should pair independently to get unique tokens/devices
- Do NOT use or delete the seeded session `seeded-session-1` unless specifically testing with it
- SSE connections are workspace-scoped to `default` workspace

### Test Server Behavior Notes
- The mock `sendMessage` returns a simulated sequence: user_message → text_delta → tool_start → tool_result → text_complete → complete (with tokenUsage)
- `cancelProcessing` only returns true if session.isProcessing is true (seeded sessions have isProcessing=false, so interrupt is no-op for them)
- `killShell` returns true only if the shellId is in session.activeShellIds (seeded sessions have empty activeShellIds)
- For interrupt testing with actual interrupted event: need to set isProcessing=true on session beforehand (create a processing session via hooks or accept that interrupt on idle is no-op per VAL-MSG-005)
- Pairing codes expire based on server TTL (default 5 minutes). For expiry testing, the test server can be started with custom TTL.
- Attachment upload supports both multipart/form-data and JSON with base64 data
- Supported MIME types: image/*, application/pdf, text/*
- Max attachment size: 5MB

### Writing flow reports
Write JSON report to: `.factory/validation/gateway-messaging-auth/user-testing/flows/<group-id>.json`
