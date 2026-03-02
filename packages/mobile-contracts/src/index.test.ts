import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { SESSION_EVENT_TYPES } from './index';

const INDEX_SOURCE = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

const REQUIRED_EXPORTS = [
  'SessionDTO',
  'MessageDTO',
  'WorkspaceDTO',
  'AttachmentDTO',
  'ErrorDTO',
  'SessionEventDTO',
  'CreateSessionOptionsDTO',
  'SendMessageOptionsDTO',
  'SessionCommandDTO',
  'PairingStartResponse',
  'PairingConfirmResponse',
  'TokenRefreshResponse',
] as const;

const EXPECTED_EVENT_TYPES = [
  'text_delta',
  'text_complete',
  'tool_start',
  'tool_result',
  'status',
  'info',
  'error',
  'typed_error',
  'complete',
  'interrupted',
  'shell_killed',
  'permission_request',
  'credential_request',
  'user_message',
  'usage_update',
  'session_created',
  'session_deleted',
  'session_status_changed',
  'name_changed',
  'session_flagged',
  'session_unflagged',
  'permission_mode_changed',
] as const;

describe('mobile contracts exports', () => {
  it('exports all required DTO contracts from src/index.ts', () => {
    for (const exportName of REQUIRED_EXPORTS) {
      expect(INDEX_SOURCE).toMatch(new RegExp(`export\\s+(?:interface|type|const)\\s+${exportName}\\b`));
    }
  });

  it('defines the full MVP session event type list', () => {
    expect(SESSION_EVENT_TYPES).toEqual(EXPECTED_EVENT_TYPES);
    expect(new Set(SESSION_EVENT_TYPES).size).toBe(SESSION_EVENT_TYPES.length);
  });
});
