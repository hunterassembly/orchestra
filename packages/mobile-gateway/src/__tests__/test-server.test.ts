import { afterEach, describe, expect, it } from 'bun:test';

import { createMockSessionManager, createTestServer } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';

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

  it('starts a testable server exposing /api/health and /api/workspaces', async () => {
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

    const workspacesResponse = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`);
    expect(workspacesResponse.status).toBe(200);
    expect(await workspacesResponse.json()).toEqual([
      {
        id: 'default',
        name: 'Default Workspace',
      },
    ]);
  });
});
