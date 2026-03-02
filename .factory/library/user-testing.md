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
