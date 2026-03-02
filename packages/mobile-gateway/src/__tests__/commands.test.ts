import { afterEach, describe, expect, it } from 'bun:test';

import type {
  SessionNameChangedEventDTO,
  SessionPermissionModeChangedEventDTO,
  SessionStatusChangedEventDTO,
} from '@craft-agent/mobile-contracts';

import { createTestServer } from '../test-server.ts';
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

  const close = async (): Promise<void> => {
    closed = true;
    controller.abort();
    await pump;
  };

  return {
    waitForEvent,
    close,
  };
}

describe('POST /api/sessions/:sessionId/commands', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'rename', name: 'New Name' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('renames session and emits name_changed', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const commandResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'rename', name: 'Renamed Session' }),
    });

    expect(commandResponse.status).toBe(200);

    const renameEvent = await sse.waitForEvent((event) => event.event === 'name_changed');
    const renamePayload = renameEvent.data as SessionNameChangedEventDTO;
    expect(renamePayload).toEqual({
      type: 'name_changed',
      sessionId: 'seeded-session-1',
      name: 'Renamed Session',
    });

    const sessionResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1`, {
      headers: AUTH_HEADERS,
    });
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json() as { name: string | null };
    expect(sessionPayload.name).toBe('Renamed Session');

    await sse.close();
  });

  it('sets session status and emits session_status_changed', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const commandResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'setSessionStatus', state: 'done' }),
    });

    expect(commandResponse.status).toBe(200);

    const statusEvent = await sse.waitForEvent((event) => event.event === 'session_status_changed');
    const statusPayload = statusEvent.data as SessionStatusChangedEventDTO;
    expect(statusPayload).toEqual({
      type: 'session_status_changed',
      sessionId: 'seeded-session-1',
      sessionStatus: 'done',
    });

    const sessionResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1`, {
      headers: AUTH_HEADERS,
    });
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json() as { sessionStatus: string | null };
    expect(sessionPayload.sessionStatus).toBe('done');

    await sse.close();
  });

  it('marks session unread and read', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();

    const markUnreadResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'markUnread' }),
    });
    expect(markUnreadResponse.status).toBe(200);

    const unreadSession = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1`, {
      headers: AUTH_HEADERS,
    });
    expect(unreadSession.status).toBe(200);
    const unreadPayload = await unreadSession.json() as { hasUnread: boolean };
    expect(unreadPayload.hasUnread).toBe(true);

    const markReadResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'markRead' }),
    });
    expect(markReadResponse.status).toBe(200);

    const readSession = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1`, {
      headers: AUTH_HEADERS,
    });
    expect(readSession.status).toBe(200);
    const readPayload = await readSession.json() as { hasUnread: boolean };
    expect(readPayload.hasUnread).toBe(false);
  });

  it('sets permission mode and emits permission_mode_changed', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const commandResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'setPermissionMode', mode: 'allow-all' }),
    });

    expect(commandResponse.status).toBe(200);

    const permissionModeEvent = await sse.waitForEvent((event) => event.event === 'permission_mode_changed');
    const permissionModePayload = permissionModeEvent.data as SessionPermissionModeChangedEventDTO;
    expect(permissionModePayload).toEqual({
      type: 'permission_mode_changed',
      sessionId: 'seeded-session-1',
      permissionMode: 'allow-all',
    });

    const sessionResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1`, {
      headers: AUTH_HEADERS,
    });
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json() as { permissionMode: string | null };
    expect(sessionPayload.permissionMode).toBe('allow-all');

    await sse.close();
  });

  it('returns 400 for unknown command type', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'unknown' }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid rename and permission mode payloads', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();

    const invalidRename = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'rename', name: '   ' }),
    });

    expect(invalidRename.status).toBe(400);

    const invalidPermissionMode = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/commands`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'setPermissionMode', mode: 'super-unsafe' }),
    });

    expect(invalidPermissionMode.status).toBe(400);
  });
});
