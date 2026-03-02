import { afterEach, describe, expect, it } from 'bun:test';

import type { SessionEventDTO, WorkspaceDTO } from '@craft-agent/mobile-contracts';

import { createMockSessionManager, createTestServer, type MockSession } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';
const AUTH_HEADERS = {
  authorization: 'Bearer test-token',
};

const startedServers: GatewayServer[] = [];

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

interface ParsedSseEvent {
  event: string;
  data: unknown;
  raw: string;
}

interface SseConnection {
  response: Response;
  waitForEvent: (matcher: (event: ParsedSseEvent) => boolean, timeoutMs?: number) => Promise<ParsedSseEvent>;
  assertNoEvent: (matcher: (event: ParsedSseEvent) => boolean, durationMs?: number) => Promise<void>;
  close: () => Promise<void>;
}

interface SseFixture {
  server: GatewayServer;
  port: number;
  manager: ReturnType<typeof createMockSessionManager>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createSseFixture(): { workspaces: WorkspaceDTO[]; sessions: MockSession[] } {
  const workspaces: WorkspaceDTO[] = [
    { id: 'default', name: 'Default Workspace' },
    { id: 'other', name: 'Other Workspace' },
  ];

  const sessions: MockSession[] = [
    {
      id: 'session-default',
      workspaceId: 'default',
      name: 'Default Session',
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
    {
      id: 'session-other',
      workspaceId: 'other',
      name: 'Other Session',
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
  ];

  return { workspaces, sessions };
}

async function startFixture(): Promise<SseFixture> {
  const fixture = createSseFixture();
  const manager = createMockSessionManager(fixture);
  const server = createTestServer({
    host: TEST_HOST,
    port: 0,
    sessionManager: manager,
    sseHeartbeatIntervalMs: 25,
  });

  startedServers.push(server);
  const { port } = await server.start();

  return {
    server,
    port,
    manager,
  };
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
    raw: block,
  };
}

async function openSse(url: string, headers: Record<string, string> = AUTH_HEADERS): Promise<SseConnection> {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers,
    signal: controller.signal,
  });

  const body = response.body;
  if (!body) {
    throw new Error('Expected response body for SSE connection');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const queue: ParsedSseEvent[] = [];
  let parseBuffer = '';
  let readError: unknown = null;
  let isClosed = false;

  const pump = (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          isClosed = true;
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
      if (!isClosed) {
        readError = error;
      }
    }
  })();

  const waitForEvent = async (
    matcher: (event: ParsedSseEvent) => boolean,
    timeoutMs = 1_500
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
    durationMs = 200
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
    isClosed = true;
    controller.abort();
    await pump;
  };

  return {
    response,
    waitForEvent,
    assertNoEvent,
    close,
  };
}

describe('GET /api/workspaces/:workspaceId/events', () => {
  it('returns text/event-stream headers and keeps the connection open', async () => {
    const fixture = await startFixture();
    const stream = await openSse(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.response.headers.get('cache-control')).toContain('no-cache');
    expect(stream.response.headers.get('connection')).toContain('keep-alive');

    await stream.close();
  });

  it('requires auth and returns 401 without Bearer token', async () => {
    const fixture = await startFixture();
    const response = await fetch(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('returns 404 for unknown workspace', async () => {
    const fixture = await startFixture();
    const response = await fetch(`http://${TEST_HOST}:${fixture.port}/api/workspaces/unknown/events`, {
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'workspace_not_found',
      message: 'Workspace not found',
    });
  });

  it('delivers only events for sessions in the subscribed workspace', async () => {
    const fixture = await startFixture();
    const stream = await openSse(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);

    fixture.server.broadcast({
      type: 'session_created',
      sessionId: 'session-other',
    } satisfies SessionEventDTO);

    await stream.assertNoEvent(
      (event) => event.event === 'session_created' && (event.data as { sessionId?: string })?.sessionId === 'session-other'
    );

    fixture.server.broadcast({
      type: 'session_created',
      sessionId: 'session-default',
    } satisfies SessionEventDTO);

    const received = await stream.waitForEvent(
      (event) => event.event === 'session_created' && (event.data as { sessionId?: string })?.sessionId === 'session-default'
    );

    expect(received.data).toEqual({
      type: 'session_created',
      sessionId: 'session-default',
    });

    await stream.close();
  });

  it('fans out the same event to multiple concurrent clients in one workspace', async () => {
    const fixture = await startFixture();
    const streamA = await openSse(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);
    const streamB = await openSse(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);

    fixture.server.broadcast({
      type: 'session_created',
      sessionId: 'session-default',
    } satisfies SessionEventDTO);

    const [eventA, eventB] = await Promise.all([
      streamA.waitForEvent((event) => event.event === 'session_created'),
      streamB.waitForEvent((event) => event.event === 'session_created'),
    ]);

    expect(eventA.data).toEqual(eventB.data);

    await streamA.close();
    await streamB.close();
  });

  it('sends heartbeat ping events on active SSE connections', async () => {
    const fixture = await startFixture();
    const stream = await openSse(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);

    const heartbeat = await stream.waitForEvent((event) => event.event === 'ping', 1_000);
    expect(heartbeat.data).toEqual({ type: 'ping' });

    await stream.close();
  });

  it('emits session lifecycle SSE events when creating and deleting sessions', async () => {
    const fixture = await startFixture();
    const stream = await openSse(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/events`);

    const createResponse = await fetch(`http://${TEST_HOST}:${fixture.port}/api/workspaces/default/sessions`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'From SSE test' }),
    });

    expect(createResponse.status).toBe(201);
    const createdSession = (await createResponse.json()) as { id: string };

    const sessionCreated = await stream.waitForEvent(
      (event) => event.event === 'session_created' && (event.data as { sessionId?: string })?.sessionId === createdSession.id
    );
    expect(sessionCreated.data).toEqual({
      type: 'session_created',
      sessionId: createdSession.id,
    });

    const deleteResponse = await fetch(`http://${TEST_HOST}:${fixture.port}/api/sessions/${createdSession.id}`, {
      method: 'DELETE',
      headers: AUTH_HEADERS,
    });

    expect(deleteResponse.status).toBe(204);

    const sessionDeleted = await stream.waitForEvent(
      (event) => event.event === 'session_deleted' && (event.data as { sessionId?: string })?.sessionId === createdSession.id
    );
    expect(sessionDeleted.data).toEqual({
      type: 'session_deleted',
      sessionId: createdSession.id,
    });

    await stream.close();
  });
});
