import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type {
  ErrorDTO,
  PairingConfirmResponse,
  PairingStartResponse,
  TokenRefreshResponse,
  WorkspaceDTO,
} from '@craft-agent/mobile-contracts';

import { createTestServer } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';

const startedServers: GatewayServer[] = [];
let originalDateNow: typeof Date.now;

beforeEach(() => {
  originalDateNow = Date.now;
});

afterEach(async () => {
  Date.now = originalDateNow;

  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

async function startServer(): Promise<{ server: GatewayServer; port: number }> {
  const server = createTestServer({ host: TEST_HOST, port: 0 });
  startedServers.push(server);
  const { port } = await server.start();
  return { server, port };
}

async function pairDevice(port: number): Promise<{ pairing: PairingStartResponse; confirmation: PairingConfirmResponse }> {
  const pairStartResponse = await fetch(`http://${TEST_HOST}:${port}/api/pair/start`, {
    method: 'POST',
  });

  expect(pairStartResponse.status).toBe(200);
  const pairing = (await pairStartResponse.json()) as PairingStartResponse;

  const pairConfirmResponse = await fetch(`http://${TEST_HOST}:${port}/api/pair/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      pairingId: pairing.pairingId,
      code: pairing.code,
    }),
  });

  expect(pairConfirmResponse.status).toBe(200);
  const confirmation = (await pairConfirmResponse.json()) as PairingConfirmResponse;

  return {
    pairing,
    confirmation,
  };
}

describe('pairing and token auth', () => {
  it('POST /api/pair/start returns pairingId + 6-digit code + expiresAt', async () => {
    const { port } = await startServer();

    const response = await fetch(`http://${TEST_HOST}:${port}/api/pair/start`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as PairingStartResponse;
    expect(typeof payload.pairingId).toBe('string');
    expect(payload.pairingId.length).toBeGreaterThan(0);
    expect(payload.code).toMatch(/^\d{6}$/);
    expect(typeof payload.expiresAt).toBe('number');
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
  });

  it('POST /api/pair/confirm with valid code returns tokens and deviceId', async () => {
    const { port } = await startServer();
    const { confirmation } = await pairDevice(port);

    expect(typeof confirmation.accessToken).toBe('string');
    expect(confirmation.accessToken.length).toBeGreaterThan(0);
    expect(typeof confirmation.refreshToken).toBe('string');
    expect(confirmation.refreshToken.length).toBeGreaterThan(0);
    expect(typeof confirmation.deviceId).toBe('string');
    expect(confirmation.deviceId.length).toBeGreaterThan(0);
    expect(typeof confirmation.expiresAt).toBe('number');
    expect(confirmation.expiresAt).toBeGreaterThan(Date.now());
  });

  it('POST /api/pair/confirm rejects invalid code with 401', async () => {
    const { port } = await startServer();

    const pairStartResponse = await fetch(`http://${TEST_HOST}:${port}/api/pair/start`, {
      method: 'POST',
    });
    const pairing = (await pairStartResponse.json()) as PairingStartResponse;
    const invalidCode = pairing.code === '000000' ? '000001' : '000000';

    const response = await fetch(`http://${TEST_HOST}:${port}/api/pair/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pairingId: pairing.pairingId,
        code: invalidCode,
      }),
    });

    expect(response.status).toBe(401);
    const payload = (await response.json()) as ErrorDTO;
    expect(payload.code).toBe('invalid_pairing_code');
  });

  it('POST /api/pair/confirm rejects expired code with 410', async () => {
    const { port } = await startServer();

    const now = 1_710_000_000_000;
    Date.now = () => now;

    const pairStartResponse = await fetch(`http://${TEST_HOST}:${port}/api/pair/start`, {
      method: 'POST',
    });
    const pairing = (await pairStartResponse.json()) as PairingStartResponse;

    Date.now = () => pairing.expiresAt + 1;

    const response = await fetch(`http://${TEST_HOST}:${port}/api/pair/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pairingId: pairing.pairingId,
        code: pairing.code,
      }),
    });

    expect(response.status).toBe(410);
    const payload = (await response.json()) as ErrorDTO;
    expect(payload.code).toBe('pairing_code_expired');
  });

  it('protected endpoints succeed with valid Bearer access token', async () => {
    const { port } = await startServer();
    const { confirmation } = await pairDevice(port);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${confirmation.accessToken}`,
      },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as WorkspaceDTO[];
    expect(payload).toEqual([
      {
        id: 'default',
        name: 'Default Workspace',
      },
    ]);
  });

  it('protected endpoints reject missing token with 401', async () => {
    const { port } = await startServer();

    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('expired access token returns 401 with token_expired', async () => {
    const { port } = await startServer();

    const now = 1_720_000_000_000;
    Date.now = () => now;
    const { confirmation } = await pairDevice(port);

    Date.now = () => confirmation.expiresAt + 1;

    const response = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${confirmation.accessToken}`,
      },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'token_expired',
      message: 'Access token expired',
    });
  });

  it('POST /api/pair/refresh returns a new access token for a valid refresh token', async () => {
    const { port } = await startServer();

    const now = 1_730_000_000_000;
    Date.now = () => now;
    const { confirmation } = await pairDevice(port);

    Date.now = () => confirmation.expiresAt + 1;

    const refreshResponse = await fetch(`http://${TEST_HOST}:${port}/api/pair/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: confirmation.refreshToken,
      }),
    });

    expect(refreshResponse.status).toBe(200);
    const refreshPayload = (await refreshResponse.json()) as TokenRefreshResponse;
    expect(typeof refreshPayload.accessToken).toBe('string');
    expect(refreshPayload.accessToken.length).toBeGreaterThan(0);
    expect(refreshPayload.accessToken).not.toBe(confirmation.accessToken);
    expect(refreshPayload.expiresAt).toBeGreaterThan(Date.now());

    const protectedResponse = await fetch(`http://${TEST_HOST}:${port}/api/workspaces`, {
      headers: {
        authorization: `Bearer ${refreshPayload.accessToken}`,
      },
    });

    expect(protectedResponse.status).toBe(200);
  });

  it('POST /api/pair/refresh rejects invalid refresh tokens with 401', async () => {
    const { port } = await startServer();

    const response = await fetch(`http://${TEST_HOST}:${port}/api/pair/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: 'invalid-refresh-token',
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'invalid_refresh_token',
      message: 'Refresh token is invalid or expired',
    });
  });
});
