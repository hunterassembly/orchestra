import { afterEach, describe, expect, it } from 'bun:test';

import { createGatewayServer } from '../index.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';

const startedServers: GatewayServer[] = [];

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

describe('createGatewayServer', () => {
  it('starts and stops cleanly on a configured port', async () => {
    const server = createGatewayServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: {},
      routes: [
        {
          method: 'GET',
          path: '/api/health',
          handler: ({ json }) => {
            json(200, { status: 'ok' });
          },
        },
      ],
    });

    startedServers.push(server);

    const { port } = await server.start();

    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });

    await server.stop();

    const stoppedResponse = await fetch(`http://${TEST_HOST}:${port}/api/health`).catch(() => null);
    expect(stoppedResponse).toBeNull();
  });

  it('dispatches method + path routes and parses params, query strings, and JSON body', async () => {
    const server = createGatewayServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: {},
      routes: [
        {
          method: 'POST',
          path: '/api/workspaces/:workspaceId/sessions/:sessionId/messages',
          handler: async ({ params, query, parseJsonBody, json }) => {
            const body = await parseJsonBody<{ text: string }>();
            json(200, {
              params,
              query,
              body,
            });
          },
        },
      ],
    });

    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(
      `http://${TEST_HOST}:${port}/api/workspaces/default/sessions/session-1/messages?tag=alpha&tag=beta&single=value`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello' }),
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      params: {
        workspaceId: 'default',
        sessionId: 'session-1',
      },
      query: {
        tag: ['alpha', 'beta'],
        single: 'value',
      },
      body: {
        text: 'hello',
      },
    });
  });

  it('returns standardized JSON errors for 404 and 405 cases', async () => {
    const server = createGatewayServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: {},
      routes: [
        {
          method: 'GET',
          path: '/api/workspaces/:workspaceId/sessions',
          handler: ({ json }) => {
            json(200, { ok: true });
          },
        },
      ],
    });

    startedServers.push(server);

    const { port } = await server.start();

    const notFound = await fetch(`http://${TEST_HOST}:${port}/api/unknown`);
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get('content-type')).toContain('application/json');
    expect(await notFound.json()).toEqual({
      code: 'not_found',
      message: 'Route not found',
    });

    const wrongMethod = await fetch(`http://${TEST_HOST}:${port}/api/workspaces/default/sessions`, {
      method: 'POST',
    });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET');
    expect(await wrongMethod.json()).toEqual({
      code: 'method_not_allowed',
      message: 'Method not allowed',
    });
  });

  it('response helpers set expected content-type and status codes', async () => {
    const server = createGatewayServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: {},
      routes: [
        {
          method: 'GET',
          path: '/api/json',
          handler: ({ json }) => {
            json(201, { created: true });
          },
        },
        {
          method: 'GET',
          path: '/api/error',
          handler: ({ error }) => {
            error(400, 'bad_request', 'Invalid payload');
          },
        },
        {
          method: 'DELETE',
          path: '/api/resource/:id',
          handler: ({ noContent }) => {
            noContent();
          },
        },
      ],
    });

    startedServers.push(server);

    const { port } = await server.start();

    const created = await fetch(`http://${TEST_HOST}:${port}/api/json`);
    expect(created.status).toBe(201);
    expect(created.headers.get('content-type')).toContain('application/json');
    expect(await created.json()).toEqual({ created: true });

    const badRequest = await fetch(`http://${TEST_HOST}:${port}/api/error`);
    expect(badRequest.status).toBe(400);
    expect(badRequest.headers.get('content-type')).toContain('application/json');
    expect(await badRequest.json()).toEqual({
      code: 'bad_request',
      message: 'Invalid payload',
    });

    const noContent = await fetch(`http://${TEST_HOST}:${port}/api/resource/abc`, {
      method: 'DELETE',
    });
    expect(noContent.status).toBe(204);
    expect(await noContent.text()).toBe('');
  });

  it('exposes a callable broadcast method', () => {
    const server = createGatewayServer({
      host: TEST_HOST,
      port: 0,
      sessionManager: {},
      routes: [],
    });

    expect(() => server.broadcast({ type: 'session_created', sessionId: 'session-1' })).not.toThrow();
  });
});
