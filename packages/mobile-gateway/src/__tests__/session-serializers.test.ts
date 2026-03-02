import { describe, expect, it } from 'bun:test';

import {
  paginateMessages,
  serializeMessage,
  serializeSession,
  serializeSessionEvent,
} from '../session-serializers.ts';

function collectUndefinedPaths(value: unknown, basePath = '$'): string[] {
  if (value === undefined) {
    return [basePath];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectUndefinedPaths(item, `${basePath}[${index}]`));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => collectUndefinedPaths(child, `${basePath}.${key}`));
  }

  return [];
}

describe('session serializers', () => {
  it('serializes MessageDTO with stable null/default values and numeric timestamp', () => {
    const message = serializeMessage({
      id: 'msg-1',
      role: 'assistant',
      content: 'hello',
      timestamp: '1710000000000',
      toolName: undefined,
      toolUseId: undefined,
      toolInput: undefined,
    });

    expect(message).toEqual({
      id: 'msg-1',
      role: 'assistant',
      content: 'hello',
      timestamp: 1710000000000,
      toolName: null,
      toolUseId: null,
      toolInput: null,
      toolResult: null,
      toolStatus: null,
      isStreaming: false,
      isPending: false,
      isIntermediate: false,
    });
  });

  it('serializes SessionDTO with no undefined values', () => {
    const session = serializeSession({
      id: 'session-1',
      workspaceId: 'default',
      name: undefined,
      lastMessageAt: new Date(1710000000000),
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'hello',
          timestamp: 1710000000000,
        },
      ],
    });

    expect(typeof session.lastMessageAt).toBe('number');
    expect(session.name).toBeNull();
    expect(collectUndefinedPaths(session)).toEqual([]);
  });

  it('paginates messages with hasMore and nextCursor metadata', () => {
    const page = paginateMessages(
      [
        { id: 'm1', role: 'user', content: 'one', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'two', timestamp: 2 },
        { id: 'm3', role: 'assistant', content: 'three', timestamp: 3 },
      ],
      {
        limit: 2,
        cursor: 0,
      }
    );

    expect(page.messages).toHaveLength(2);
    expect(page.messages[0]?.id).toBe('m1');
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('2');
  });

  it('serializes status, info, error, and typed_error events with DTO fields', () => {
    expect(
      serializeSessionEvent({
        type: 'status',
        sessionId: 'session-1',
        message: 'Compacting context',
        statusType: 'compacting',
      })
    ).toEqual({
      type: 'status',
      sessionId: 'session-1',
      message: 'Compacting context',
      statusType: 'compacting',
    });

    expect(
      serializeSessionEvent({
        type: 'info',
        sessionId: 'session-1',
        message: 'Compaction complete',
        statusType: 'compaction_complete',
        level: 'success',
        timestamp: '1710000000000',
      })
    ).toEqual({
      type: 'info',
      sessionId: 'session-1',
      message: 'Compaction complete',
      statusType: 'compaction_complete',
      level: 'success',
      timestamp: 1710000000000,
    });

    expect(
      serializeSessionEvent({
        type: 'error',
        sessionId: 'session-1',
        error: 'Request failed',
        timestamp: new Date(1710000000001),
      })
    ).toEqual({
      type: 'error',
      sessionId: 'session-1',
      error: 'Request failed',
      timestamp: 1710000000001,
    });

    expect(
      serializeSessionEvent({
        type: 'typed_error',
        sessionId: 'session-1',
        timestamp: 1710000000002,
        error: {
          code: 'token_expired',
          message: 'Session token expired',
          title: 'Authentication Needed',
          canRetry: true,
          retryDelayMs: 500,
          details: ['Sign in again'],
          originalError: '401',
          actions: [
            {
              key: 'reauth',
              label: 'Re-authenticate',
              action: 'reauth',
              command: 'open_settings',
            },
          ],
        },
      })
    ).toEqual({
      type: 'typed_error',
      sessionId: 'session-1',
      timestamp: 1710000000002,
      error: {
        code: 'token_expired',
        message: 'Session token expired',
        title: 'Authentication Needed',
        canRetry: true,
        retryDelayMs: 500,
        details: ['Sign in again'],
        originalError: '401',
        actions: [
          {
            key: 'reauth',
            label: 'Re-authenticate',
            action: 'reauth',
            command: 'open_settings',
          },
        ],
      },
    });
  });

  it('serializes interactive permission_request and credential_request events with nested request payloads', () => {
    expect(
      serializeSessionEvent({
        type: 'permission_request',
        sessionId: 'session-1',
        request: {
          requestId: 'perm-1',
          toolName: 'bash',
          command: 'rm -rf ./tmp',
          description: 'Delete temp directory',
          type: 'bash',
        },
      })
    ).toEqual({
      type: 'permission_request',
      sessionId: 'session-1',
      request: {
        requestId: 'perm-1',
        toolName: 'bash',
        command: 'rm -rf ./tmp',
        description: 'Delete temp directory',
        type: 'bash',
      },
    });

    expect(
      serializeSessionEvent({
        type: 'credential_request',
        sessionId: 'session-1',
        request: {
          requestId: 'cred-1',
          sourceSlug: 'slack',
          sourceName: 'Slack',
          inputMode: 'multi-header',
          headerName: 'Authorization',
          headerNames: ['Authorization', 'X-Workspace'],
          labels: {
            credential: 'API Key',
            username: 'User',
            password: 'Password',
          },
          description: 'Provide Slack credentials',
          hint: 'Use your workspace token',
          sourceUrl: 'https://api.slack.com',
          passwordRequired: true,
        },
      })
    ).toEqual({
      type: 'credential_request',
      sessionId: 'session-1',
      request: {
        requestId: 'cred-1',
        sourceSlug: 'slack',
        sourceName: 'Slack',
        inputMode: 'multi-header',
        headerName: 'Authorization',
        headerNames: ['Authorization', 'X-Workspace'],
        labels: {
          credential: 'API Key',
          username: 'User',
          password: 'Password',
        },
        description: 'Provide Slack credentials',
        hint: 'Use your workspace token',
        sourceUrl: 'https://api.slack.com',
        passwordRequired: true,
      },
    });
  });

  it('serializes usage_update and session lifecycle events with expected metadata', () => {
    expect(
      serializeSessionEvent({
        type: 'usage_update',
        sessionId: 'session-1',
        tokenUsage: {
          inputTokens: '42',
          contextWindow: '200000',
        },
      })
    ).toEqual({
      type: 'usage_update',
      sessionId: 'session-1',
      tokenUsage: {
        inputTokens: 42,
        contextWindow: 200000,
      },
    });

    expect(
      serializeSessionEvent({
        type: 'session_created',
        sessionId: 'session-1',
        parentSessionId: 'session-parent',
      })
    ).toEqual({
      type: 'session_created',
      sessionId: 'session-1',
      parentSessionId: 'session-parent',
    });

    expect(
      serializeSessionEvent({
        type: 'session_deleted',
        sessionId: 'session-1',
      })
    ).toEqual({
      type: 'session_deleted',
      sessionId: 'session-1',
    });

    expect(
      serializeSessionEvent({
        type: 'session_status_changed',
        sessionId: 'session-1',
        sessionStatus: 'in_progress',
      })
    ).toEqual({
      type: 'session_status_changed',
      sessionId: 'session-1',
      sessionStatus: 'in_progress',
    });

    expect(
      serializeSessionEvent({
        type: 'name_changed',
        sessionId: 'session-1',
        name: 'Renamed Session',
      })
    ).toEqual({
      type: 'name_changed',
      sessionId: 'session-1',
      name: 'Renamed Session',
    });

    expect(
      serializeSessionEvent({
        type: 'session_flagged',
        sessionId: 'session-1',
      })
    ).toEqual({
      type: 'session_flagged',
      sessionId: 'session-1',
    });

    expect(
      serializeSessionEvent({
        type: 'session_unflagged',
        sessionId: 'session-1',
      })
    ).toEqual({
      type: 'session_unflagged',
      sessionId: 'session-1',
    });
  });
});
