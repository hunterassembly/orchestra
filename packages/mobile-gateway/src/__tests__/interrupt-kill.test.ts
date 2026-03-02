import { afterEach, describe, expect, it } from 'bun:test';

import { createMockSessionManager, createTestServer } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';
const AUTH_HEADERS = {
  authorization: 'Bearer test-token',
};

const startedServers: GatewayServer[] = [];

interface ParsedSseEvent {
  event: string;
  data: unknown;
}

interface SseConnection {
  waitForEvent: (matcher: (event: ParsedSseEvent) => boolean, timeoutMs?: number) => Promise<ParsedSseEvent>;
  assertNoEvent: (matcher: (event: ParsedSseEvent) => boolean, durationMs?: number) => Promise<void>;
  close: () => Promise<void>;
}

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0 || lines.every((line) => line.startsWith(':'))) {
    return null;
  }

  let eventType = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice('event:'.length).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  const dataText = dataLines.join('\n');
  const parsedData = dataText.length > 0 ? JSON.parse(dataText) : null;

  return {
    event: eventType,
    data: parsedData,
  };
}

async function openSse(url: string): Promise<SseConnection> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers: AUTH_HEADERS,
    signal: controller.signal,
  });

  expect(response.status).toBe(200);
  const body = response.body;
  if (!body) {
    throw new Error('Expected SSE response body');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: ParsedSseEvent[] = [];
  let parseBuffer = '';
  let readError: unknown = null;
  let closed = false;

  const pump = (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          closed = true;
          break;
        }

        parseBuffer += decoder.decode(result.value, { stream: true });

        while (true) {
          const delimiterIndex = parseBuffer.indexOf('\n\n');
          if (delimiterIndex < 0) {
            break;
          }

          const block = parseBuffer.slice(0, delimiterIndex);
          parseBuffer = parseBuffer.slice(delimiterIndex + 2);

          const parsedEvent = parseSseBlock(block);
          if (parsedEvent) {
            queue.push(parsedEvent);
          }
        }
      }
    } catch (error) {
      if (!closed) {
        readError = error;
      }
    }
  })();

  const waitForEvent = async (
    matcher: (event: ParsedSseEvent) => boolean,
    timeoutMs = 2_000
  ): Promise<ParsedSseEvent> => {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (readError) {
        throw readError;
      }

      const index = queue.findIndex(matcher);
      if (index >= 0) {
        const [event] = queue.splice(index, 1);
        if (!event) {
          throw new Error('Expected queued SSE event');
        }

        return event;
      }

      await sleep(10);
    }

    throw new Error('Timed out waiting for SSE event');
  };

  const assertNoEvent = async (
    matcher: (event: ParsedSseEvent) => boolean,
    durationMs = 250
  ): Promise<void> => {
    const deadline = Date.now() + durationMs;

    while (Date.now() < deadline) {
      if (readError) {
        throw readError;
      }

      if (queue.some(matcher)) {
        throw new Error('Unexpected SSE event received');
      }

      await sleep(10);
    }
  };

  const close = async (): Promise<void> => {
    closed = true;
    controller.abort();
    await pump;
  };

  return {
    waitForEvent,
    assertNoEvent,
    close,
  };
}

describe('POST /api/sessions/:sessionId/interrupt', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/processing-session/interrupt`, {
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('returns 200, calls cancelProcessing, and emits interrupted when actively processing', async () => {
    let cancelCallCount = 0;
    const manager = createMockSessionManager({
      sessions: [
        {
          id: 'processing-session',
          workspaceId: 'default',
          name: 'Processing Session',
          lastMessageAt: Date.now(),
          isProcessing: true,
          sessionStatus: null,
          hasUnread: false,
          permissionMode: 'ask',
          labels: [],
          preview: null,
          messageCount: 0,
          tokenUsage: null,
          messages: [],
          activeShellIds: ['shell-1'],
        },
      ],
      hooks: {
        onCancelProcessing() {
          cancelCallCount += 1;
        },
      },
    });

    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: manager,
      sseHeartbeatIntervalMs: 10_000,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/processing-session/interrupt`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    expect(cancelCallCount).toBe(1);

    const interrupted = await sse.waitForEvent((event) => event.event === 'interrupted');
    expect(interrupted.data).toEqual({
      type: 'interrupted',
      sessionId: 'processing-session',
    });

    await sse.close();
  });

  it('returns 200 as a no-op when session is idle (no interrupted event)', async () => {
    let cancelCallCount = 0;
    const manager = createMockSessionManager({
      sessions: [
        {
          id: 'idle-session',
          workspaceId: 'default',
          name: 'Idle Session',
          lastMessageAt: Date.now(),
          isProcessing: false,
          sessionStatus: null,
          hasUnread: false,
          permissionMode: 'ask',
          labels: [],
          preview: null,
          messageCount: 0,
          tokenUsage: null,
          messages: [],
        },
      ],
      hooks: {
        onCancelProcessing() {
          cancelCallCount += 1;
        },
      },
    });

    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: manager,
      sseHeartbeatIntervalMs: 10_000,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/idle-session/interrupt`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    expect(cancelCallCount).toBe(1);

    await sse.assertNoEvent((event) => event.event === 'interrupted');

    await sse.close();
  });
});

describe('POST /api/sessions/:sessionId/shells/:shellId/kill', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/processing-session/shells/shell-1/kill`, {
      method: 'POST',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('returns 200, calls killShell, and emits shell_killed for known shell IDs', async () => {
    let killCalls: Array<{ sessionId: string; shellId: string }> = [];
    const manager = createMockSessionManager({
      sessions: [
        {
          id: 'processing-session',
          workspaceId: 'default',
          name: 'Processing Session',
          lastMessageAt: Date.now(),
          isProcessing: true,
          sessionStatus: null,
          hasUnread: false,
          permissionMode: 'ask',
          labels: [],
          preview: null,
          messageCount: 0,
          tokenUsage: null,
          messages: [],
          activeShellIds: ['shell-1'],
        },
      ],
      hooks: {
        onKillShell(sessionId, shellId) {
          killCalls.push({ sessionId, shellId });
        },
      },
    });

    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: manager,
      sseHeartbeatIntervalMs: 10_000,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/processing-session/shells/shell-1/kill`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    expect(killCalls).toEqual([{ sessionId: 'processing-session', shellId: 'shell-1' }]);

    const shellKilled = await sse.waitForEvent((event) => event.event === 'shell_killed');
    expect(shellKilled.data).toEqual({
      type: 'shell_killed',
      sessionId: 'processing-session',
      shellId: 'shell-1',
    });

    await sse.close();
  });

  it('returns 404 for unknown shell IDs', async () => {
    const manager = createMockSessionManager({
      sessions: [
        {
          id: 'processing-session',
          workspaceId: 'default',
          name: 'Processing Session',
          lastMessageAt: Date.now(),
          isProcessing: true,
          sessionStatus: null,
          hasUnread: false,
          permissionMode: 'ask',
          labels: [],
          preview: null,
          messageCount: 0,
          tokenUsage: null,
          messages: [],
          activeShellIds: ['shell-1'],
        },
      ],
    });

    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: manager,
      sseHeartbeatIntervalMs: 10_000,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/processing-session/shells/unknown/kill`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'shell_not_found',
      message: 'Shell not found',
    });

    await sse.assertNoEvent((event) => event.event === 'shell_killed');

    await sse.close();
  });
});
