import { describe, expect, it } from 'bun:test';

import { paginateMessages, serializeMessage, serializeSession } from '../session-serializers.ts';

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
});
