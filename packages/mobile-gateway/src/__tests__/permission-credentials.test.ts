import { afterEach, describe, expect, it } from 'bun:test';

import type { CredentialResponseDTO, PermissionResponseOptionsDTO } from '@craft-agent/mobile-contracts';

import { createMockSessionManager, createTestServer } from '../test-server.ts';
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

describe('POST /api/sessions/:sessionId/permissions/:requestId', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/permissions/perm-1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ allowed: true }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid payloads', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/permissions/perm-1`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ allowed: 'yes' }),
    });

    expect(response.status).toBe(400);
  });

  it('responds to permission request and forwards payload', async () => {
    let called = false;
    let captured: {
      sessionId: string;
      requestId: string;
      allowed: boolean;
      alwaysAllow: boolean;
      options?: PermissionResponseOptionsDTO;
    } | null = null;

    const manager = createMockSessionManager({
      hooks: {
        onRespondToPermission: (sessionId, requestId, allowed, alwaysAllow, options) => {
          called = true;
          captured = { sessionId, requestId, allowed, alwaysAllow, options };
          return true;
        },
      },
    });

    const server = createTestServer({ host: TEST_HOST, port: 0, sessionManager: manager });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/permissions/perm-1`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        allowed: true,
        alwaysAllow: true,
        options: { rememberForMinutes: 15 },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(called).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured).toMatchObject({
      sessionId: 'seeded-session-1',
      requestId: 'perm-1',
      allowed: true,
      alwaysAllow: true,
      options: { rememberForMinutes: 15 },
    });
  });

  it('returns 404 when request is not pending', async () => {
    const manager = createMockSessionManager({
      hooks: {
        onRespondToPermission: () => false,
      },
    });

    const server = createTestServer({ host: TEST_HOST, port: 0, sessionManager: manager });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/permissions/perm-missing`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ allowed: false }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'permission_request_not_found',
      message: 'Permission request not found',
    });
  });
});

describe('POST /api/sessions/:sessionId/credentials/:requestId', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/credentials/cred-1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'credential', cancelled: true }),
    });

    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid payloads', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/credentials/cred-1`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cancelled: false }),
    });

    expect(response.status).toBe(400);
  });

  it('responds to credential request and forwards payload', async () => {
    let captured: {
      sessionId: string;
      requestId: string;
      response: CredentialResponseDTO;
    } | null = null;

    const manager = createMockSessionManager({
      hooks: {
        onRespondToCredential: (sessionId, requestId, response) => {
          captured = { sessionId, requestId, response };
          return true;
        },
      },
    });

    const server = createTestServer({ host: TEST_HOST, port: 0, sessionManager: manager });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/credentials/cred-1`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'credential',
        headers: {
          'DD-API-KEY': 'api-key',
          'DD-APPLICATION-KEY': 'app-key',
        },
        cancelled: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(captured).not.toBeNull();
    expect(captured).toMatchObject({
      sessionId: 'seeded-session-1',
      requestId: 'cred-1',
      response: {
        type: 'credential',
        headers: {
          'DD-API-KEY': 'api-key',
          'DD-APPLICATION-KEY': 'app-key',
        },
        cancelled: false,
      },
    });
  });

  it('returns 404 when request is not pending', async () => {
    const manager = createMockSessionManager({
      hooks: {
        onRespondToCredential: () => false,
      },
    });

    const server = createTestServer({ host: TEST_HOST, port: 0, sessionManager: manager });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/credentials/cred-missing`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'credential', cancelled: true }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 'credential_request_not_found',
      message: 'Credential request not found',
    });
  });
});
