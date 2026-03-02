import { afterEach, describe, expect, it } from 'bun:test';

import { createMockSessionManager, createTestServer } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';
const AUTH_HEADERS = {
  authorization: 'Bearer test',
};

const startedServers: GatewayServer[] = [];

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

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

  it('requires auth for GET /api/workspaces and returns WorkspaceDTO[] when authenticated', async () => {
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
    });
    startedServers.push(server);

    const { port } = await server.start();

    const unauthorizedResponse = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`);
    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get('content-type')).toContain('application/json');
    expect(await unauthorizedResponse.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });

    const workspacesResponse = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`, {
      headers: AUTH_HEADERS,
    });

    expect(workspacesResponse.status).toBe(200);
    expect(workspacesResponse.headers.get('content-type')).toContain('application/json');
    expect(await workspacesResponse.json()).toEqual([
      {
        id: 'default',
        name: 'Default Workspace',
      },
    ]);
  });

  it('returns 404 for unknown workspace IDs on workspace-scoped endpoints', async () => {
    const server = createTestServer({
      host: TEST_HOST,
      port: 0,
    });
    startedServers.push(server);

    const { port } = await server.start();

    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/unknown/sessions`, {
      headers: AUTH_HEADERS,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      code: 'workspace_not_found',
      message: 'Workspace not found',
    });
  });
});
