import { afterEach, describe, expect, it } from 'bun:test';

import type { CreateSessionOptionsDTO, MessageDTO, PermissionModeDTO, SessionDTO } from '@craft-agent/mobile-contracts';

import { createMockSessionManager, createTestServer } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';
const AUTH_HEADERS = {
  authorization: 'Bearer test-token',
};

const startedServers: GatewayServer[] = [];

interface TestMessage {
  id: string;
  role: MessageDTO['role'];
  content: string;
  timestamp: number | string | Date;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolStatus?: MessageDTO['toolStatus'];
  isStreaming?: boolean;
  isPending?: boolean;
  isIntermediate?: boolean;
}

interface TestSession {
  id: string;
  workspaceId: string;
  name?: string | null;
  lastMessageAt?: number | string | Date;
  isProcessing?: boolean;
  sessionStatus?: string | null;
  hasUnread?: boolean;
  permissionMode?: PermissionModeDTO | null;
  labels?: string[];
  preview?: string | null;
  messageCount?: number;
  tokenUsage?: SessionDTO['tokenUsage'];
  workingDirectory?: string | 'user_default' | 'none';
  messages?: TestMessage[];
}

interface SessionManagerFixture {
  manager: ReturnType<typeof createMockSessionManager>;
  getLastCreateCall: () => { workspaceId: string; options: CreateSessionOptionsDTO } | null;
}

type SessionDetailsResponse = SessionDTO & {
  messages: MessageDTO[];
  hasMore: boolean;
  nextCursor: string | null;
};

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

function createSessionManagerFixture(): SessionManagerFixture {
  const workspaces = [
    {
      id: 'default',
      name: 'Default Workspace',
    },
  ];

  const sessions: TestSession[] = [
    {
      id: 'session-1',
      workspaceId: 'default',
      name: 'Planning',
      lastMessageAt: '1710000000100',
      isProcessing: false,
      sessionStatus: null,
      hasUnread: true,
      permissionMode: 'ask',
      labels: ['inbox'],
      preview: 'latest preview',
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'hello',
          timestamp: '1710000000000',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'world',
          timestamp: new Date(1710000000100),
          toolName: undefined,
          toolUseId: undefined,
        },
        {
          id: 'msg-3',
          role: 'assistant',
          content: 'done',
          timestamp: 1710000000200,
          isStreaming: false,
        },
      ],
    },
  ];

  let lastCreateCall: { workspaceId: string; options: CreateSessionOptionsDTO } | null = null;

  const manager = createMockSessionManager({
    workspaces,
    sessions,
    hooks: {
      onCreateSession(workspaceId, options) {
        lastCreateCall = { workspaceId, options };
      },
    },
  });

  return {
    manager,
    getLastCreateCall: () => lastCreateCall,
  };
}

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

describe('test-server utilities', () => {
  it('creates a mock session manager implementation', async () => {
    const sessionManager = createMockSessionManager();
    const workspaces = await sessionManager.getWorkspaces();

    expect(workspaces).toEqual([
      {
        id: 'default',
        name: 'Default Workspace',
      },
    ]);
  });

  it('exposes GET /api/health without auth and returns JSON with status/version', async () => {
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
    });
    startedServers.push(server);

    const { port } = await server.start();

    const healthResponse = await fetch(`http://${TEST_HOST}:${port}/api/health`);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({
      status: 'ok',
      version: '0.0.0',
    });

    expect(healthResponse.headers.get('content-type')).toContain('application/json');
  });

  it('requires auth for protected workspace + session endpoints', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const protectedEndpoints = [
      '/api/workspaces',
      '/api/workspaces/default/sessions',
      '/api/sessions/session-1',
    ];

    for (const endpoint of protectedEndpoints) {
      const response = await fetch(`http://${TEST_HOST}:${port}${endpoint}`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: 'unauthorized',
        message: 'Authorization required',
      });
    }
  });

  it('returns workspace DTOs when authenticated', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`, {
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: 'default',
        name: 'Default Workspace',
      },
    ]);
  });

  it('lists sessions for a workspace as SessionDTO[]', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/default/sessions`, {
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as SessionDTO[];

    expect(payload).toHaveLength(1);
    const listedSession = payload[0];
    expect(listedSession).toBeDefined();
    if (!listedSession) {
      throw new Error('Expected a listed session');
    }

    expect(listedSession).toMatchObject({
      id: 'session-1',
      workspaceId: 'default',
      name: 'Planning',
      permissionMode: 'ask',
    });
    expect(typeof listedSession.lastMessageAt).toBe('number');
    expect(listedSession.messages).toBeUndefined();
  });

  it('creates sessions with CreateSessionOptions and returns 201 SessionDTO', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const createResponse = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/default/sessions`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Created Session',
        permissionMode: 'safe',
        workingDirectory: '/tmp/project',
      }),
    });

    expect(createResponse.status).toBe(201);
    const payload = (await createResponse.json()) as SessionDTO;
    expect(payload).toMatchObject({
      workspaceId: 'default',
      name: 'Created Session',
      permissionMode: 'safe',
    });

    const createCall = fixture.getLastCreateCall();
    expect(createCall).toEqual({
      workspaceId: 'default',
      options: {
        name: 'Created Session',
        permissionMode: 'safe',
        workingDirectory: '/tmp/project',
      },
    });
  });

  it('gets a session with paginated messages and hasMore metadata', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();

    const firstPage = await fetch(`http://${TEST_HOST}:${port}/api/sessions/session-1?limit=2`, {
      headers: AUTH_HEADERS,
    });

    expect(firstPage.status).toBe(200);
    const firstPayload = (await firstPage.json()) as SessionDetailsResponse;
    expect(firstPayload.id).toBe('session-1');
    expect(firstPayload.messages).toHaveLength(2);
    expect(firstPayload.hasMore).toBe(true);
    expect(firstPayload.nextCursor).toBe('2');

    const secondPage = await fetch(
      `http://${TEST_HOST}:${port}/api/sessions/session-1?limit=2&cursor=${firstPayload.nextCursor as string}`,
      {
        headers: AUTH_HEADERS,
      }
    );

    expect(secondPage.status).toBe(200);
    const secondPayload = (await secondPage.json()) as SessionDetailsResponse;
    expect(secondPayload.messages).toHaveLength(1);
    const pagedMessage = secondPayload.messages[0];
    expect(pagedMessage).toBeDefined();
    if (!pagedMessage) {
      throw new Error('Expected a paged message');
    }

    expect(pagedMessage.id).toBe('msg-3');
    expect(secondPayload.hasMore).toBe(false);
  });

  it('deletes a session and subsequent GET returns 404', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const deleteResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/session-1`, {
      method: 'DELETE',
      headers: AUTH_HEADERS,
    });

    expect(deleteResponse.status).toBe(204);
    expect(await deleteResponse.text()).toBe('');

    const getResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/session-1`, {
      headers: AUTH_HEADERS,
    });

    expect(getResponse.status).toBe(404);
    expect(await getResponse.json()).toEqual({
      code: 'session_not_found',
      message: 'Session not found',
    });
  });

  it('returns 404 for unknown workspace IDs on workspace-scoped endpoints', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/unknown/sessions`, {
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'workspace_not_found',
      message: 'Workspace not found',
    });
  });

  it('returns 400 for invalid pagination or create payload with consistent ErrorDTO shape', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();

    const invalidCreate = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/default/sessions`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ permissionMode: 'invalid-mode' }),
    });

    expect(invalidCreate.status).toBe(400);
    expect(await invalidCreate.json()).toEqual({
      code: 'invalid_request',
      message: 'Invalid create session options',
    });

    const invalidLimit = await fetch(`http://${TEST_HOST}:${port}/api/sessions/session-1?limit=0`, {
      headers: AUTH_HEADERS,
    });

    expect(invalidLimit.status).toBe(400);
    expect(await invalidLimit.json()).toEqual({
      code: 'invalid_query',
      message: 'limit must be a positive integer',
    });
  });

  it('serializes DTO payloads with no undefined values and numeric timestamps', async () => {
    const fixture = createSessionManagerFixture();
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: fixture.manager,
    });
    startedServers.push(server);

    const { port } = await server.start();
    const listResponse = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/default/sessions`, {
      headers: AUTH_HEADERS,
    });
    const listPayload = (await listResponse.json()) as SessionDTO[];

    const sessionResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/session-1`, {
      headers: AUTH_HEADERS,
    });
    const sessionPayload = (await sessionResponse.json()) as SessionDetailsResponse;

    const undefinedPaths = [
      ...collectUndefinedPaths(listPayload),
      ...collectUndefinedPaths(sessionPayload),
    ];

    expect(undefinedPaths).toEqual([]);
    const listSession = listPayload[0];
    expect(listSession).toBeDefined();
    if (!listSession) {
      throw new Error('Expected listed session payload');
    }

    expect(typeof listSession.lastMessageAt).toBe('number');
    for (const message of sessionPayload.messages as MessageDTO[]) {
      expect(typeof message.timestamp).toBe('number');
    }
  });
});
