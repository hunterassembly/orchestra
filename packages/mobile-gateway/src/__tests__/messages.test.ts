import { afterEach, describe, expect, it } from 'bun:test';

import type { SessionCompleteEventDTO, SessionEventDTO, SessionUserMessageEventDTO } from '@craft-agent/mobile-contracts';

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

describe('POST /api/sessions/:sessionId/messages', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'Hello' }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('returns 400 for empty or missing text payloads', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();

    const emptyPayload = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/messages`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: '   ' }),
    });

    expect(emptyPayload.status).toBe(400);

    const missingTextPayload = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/messages`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(missingTextPayload.status).toBe(400);
  });

  it('returns 404 for unknown session IDs', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/unknown/messages`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'Hello' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'session_not_found',
      message: 'Session not found',
    });
  });

  it('accepts valid message payloads and streams user + core response events with contract shapes', async () => {
    const manager = createMockSessionManager();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const sse = await openSse(`http://${TEST_HOST}:${port}/api/workspaces/default/events`);

    const sendResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/messages`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Run a test tool call',
        options: {
          optimisticMessageId: 'optimistic-1',
          ultrathinkEnabled: true,
          skillSlugs: ['helper-skill'],
        },
      }),
    });

    expect([200, 202]).toContain(sendResponse.status);

    const userMessageEvent = await sse.waitForEvent((event) => event.event === 'user_message');
    const textDeltaEvent = await sse.waitForEvent((event) => event.event === 'text_delta');
    const toolStartEvent = await sse.waitForEvent((event) => event.event === 'tool_start');
    const toolResultEvent = await sse.waitForEvent((event) => event.event === 'tool_result');
    const textCompleteEvent = await sse.waitForEvent((event) => event.event === 'text_complete');
    const completeEvent = await sse.waitForEvent((event) => event.event === 'complete');

    const userPayload = userMessageEvent.data as SessionUserMessageEventDTO;
    expect(userPayload.type).toBe('user_message');
    expect(userPayload.sessionId).toBe('seeded-session-1');
    expect(userPayload.status).toBe('accepted');
    expect(userPayload.optimisticMessageId).toBe('optimistic-1');
    expect(userPayload.message.role).toBe('user');
    expect(userPayload.message.content).toBe('Run a test tool call');
    expect(typeof userPayload.message.timestamp).toBe('number');

    const deltaPayload = textDeltaEvent.data as SessionEventDTO;
    expect(deltaPayload.type).toBe('text_delta');
    if (deltaPayload.type === 'text_delta') {
      expect(deltaPayload.sessionId).toBe('seeded-session-1');
      expect(typeof deltaPayload.delta).toBe('string');
      expect(deltaPayload.delta.length).toBeGreaterThan(0);
    }

    const toolStartPayload = toolStartEvent.data as SessionEventDTO;
    expect(toolStartPayload.type).toBe('tool_start');
    if (toolStartPayload.type === 'tool_start') {
      expect(toolStartPayload.sessionId).toBe('seeded-session-1');
      expect(typeof toolStartPayload.toolUseId).toBe('string');
      expect(typeof toolStartPayload.toolName).toBe('string');
      expect(typeof toolStartPayload.toolInput).toBe('object');
      expect(toolStartPayload.toolInput).not.toBeNull();
    }

    const toolResultPayload = toolResultEvent.data as SessionEventDTO;
    expect(toolResultPayload.type).toBe('tool_result');
    if (toolResultPayload.type === 'tool_result') {
      expect(toolResultPayload.sessionId).toBe('seeded-session-1');
      expect(typeof toolResultPayload.toolUseId).toBe('string');
      expect(typeof toolResultPayload.toolName).toBe('string');
      expect(typeof toolResultPayload.result).toBe('string');
    }

    const textCompletePayload = textCompleteEvent.data as SessionEventDTO;
    expect(textCompletePayload.type).toBe('text_complete');
    if (textCompletePayload.type === 'text_complete') {
      expect(textCompletePayload.sessionId).toBe('seeded-session-1');
      expect(typeof textCompletePayload.text).toBe('string');
      expect(textCompletePayload.text.length).toBeGreaterThan(0);
    }

    const completePayload = completeEvent.data as SessionCompleteEventDTO;
    expect(completePayload.type).toBe('complete');
    expect(completePayload.sessionId).toBe('seeded-session-1');
    expect(completePayload.tokenUsage).toEqual({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      contextTokens: expect.any(Number),
      costUsd: expect.any(Number),
    });

    await sse.close();
  });
});
