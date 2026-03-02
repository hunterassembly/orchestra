# API Contracts

Gateway API endpoint reference and contract details.

**What belongs here:** Endpoint specs, DTO shapes, event types, auth requirements.

---

## Endpoints (MVP)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |
| POST | /api/pair/start | No | Start pairing, returns code |
| POST | /api/pair/confirm | No | Confirm pairing, returns tokens |
| POST | /api/pair/refresh | No | Refresh access token |
| POST | /api/devices/:deviceId/revoke | Yes | Revoke device, invalidate tokens |
| GET | /api/workspaces | Yes | List workspaces |
| GET | /api/workspaces/:id/sessions | Yes | List sessions |
| POST | /api/workspaces/:id/sessions | Yes | Create session |
| GET | /api/sessions/:id | Yes | Get session with messages |
| DELETE | /api/sessions/:id | Yes | Delete session |
| POST | /api/sessions/:id/messages | Yes | Send message |
| POST | /api/sessions/:id/interrupt | Yes | Interrupt processing |
| POST | /api/sessions/:id/shells/:shellId/kill | Yes | Kill background shell |
| POST | /api/sessions/:id/commands | Yes | Session commands |
| POST | /api/sessions/:id/attachments | Yes | Upload attachment |
| GET | /api/workspaces/:id/events | Yes | SSE event stream |

## Session Commands (MVP)
- `rename` — `{ type: "rename", name: string }`
- `setSessionStatus` — `{ type: "setSessionStatus", state: SessionStatus }`
- `markRead` — `{ type: "markRead" }`
- `markUnread` — `{ type: "markUnread" }`
- `setPermissionMode` — `{ type: "setPermissionMode", mode: PermissionMode }`

## SSE Event Types (MVP)
Core: text_delta, text_complete, tool_start, tool_result, status, info, error, typed_error, complete, interrupted
Session: session_created, session_deleted, session_status_changed, name_changed, session_flagged, session_unflagged
Interactive: permission_request, credential_request, user_message, usage_update
