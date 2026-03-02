import { afterEach, describe, expect, it } from 'bun:test';

import type { AttachmentDTO, MessageDTO, SessionDTO } from '@craft-agent/mobile-contracts';

import { createTestServer } from '../test-server.ts';
import type { GatewayServer } from '../index.ts';

const TEST_HOST = '127.0.0.1';
const AUTH_HEADERS = {
  authorization: 'Bearer test-token',
};

const startedServers: GatewayServer[] = [];

type SessionDetailsResponse = SessionDTO & {
  messages: MessageDTO[];
};

afterEach(async () => {
  for (const server of startedServers.splice(0)) {
    await server.stop();
  }
});

function createMultipartBody(contents: string, mimeType: string, filename: string): FormData {
  const body = new FormData();
  body.append('file', new Blob([contents], { type: mimeType }), filename);
  return body;
}

describe('POST /api/sessions/:sessionId/attachments', () => {
  it('requires auth', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      body: createMultipartBody('hello', 'text/plain', 'hello.txt'),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 'unauthorized',
      message: 'Authorization required',
    });
  });

  it('uploads multipart attachments and returns AttachmentDTO', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: createMultipartBody('hello world', 'text/plain', 'hello.txt'),
    });

    expect([200, 201]).toContain(response.status);
    const payload = (await response.json()) as AttachmentDTO;

    expect(typeof payload.id).toBe('string');
    expect(payload.id.length).toBeGreaterThan(0);
    expect(payload.name).toBe('hello.txt');
    expect(payload.mimeType).toBe('text/plain');
    expect(payload.size).toBe('hello world'.length);
  });

  it('uploads base64 JSON attachments and returns AttachmentDTO', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'payload.txt',
        mimeType: 'text/plain',
        data: Buffer.from('encoded payload').toString('base64'),
      }),
    });

    expect([200, 201]).toContain(response.status);
    const payload = (await response.json()) as AttachmentDTO;

    expect(payload.name).toBe('payload.txt');
    expect(payload.mimeType).toBe('text/plain');
    expect(payload.size).toBe('encoded payload'.length);
  });

  it('rejects unsupported MIME types with 415', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: createMultipartBody('PK\u0003\u0004', 'application/zip', 'archive.zip'),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      code: 'unsupported_media_type',
      message: 'Attachment MIME type is not supported',
    });
  });

  it('rejects oversized files with 413', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();
    const largePayload = 'a'.repeat(6 * 1024 * 1024);

    const response = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: createMultipartBody(largePayload, 'text/plain', 'large.txt'),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      code: 'payload_too_large',
      message: 'Attachment exceeds maximum allowed size',
    });
  });

  it('rejects missing or empty files with 400', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();

    const emptyResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: createMultipartBody('', 'text/plain', 'empty.txt'),
    });

    expect(emptyResponse.status).toBe(400);
    expect(await emptyResponse.json()).toEqual({
      code: 'invalid_request',
      message: 'Attachment file is required',
    });
  });

  it('allows uploaded attachment references in subsequent message sends', async () => {
    const server = createTestServer({ host: TEST_HOST, port: 0 });
    startedServers.push(server);

    const { port } = await server.start();

    const uploadResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/attachments`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: createMultipartBody('note', 'text/plain', 'note.txt'),
    });

    expect([200, 201]).toContain(uploadResponse.status);
    const uploaded = (await uploadResponse.json()) as AttachmentDTO;

    const messageResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1/messages`, {
      method: 'POST',
      headers: {
        ...AUTH_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Please use this file',
        attachments: [{ id: uploaded.id }],
      }),
    });

    expect([200, 202]).toContain(messageResponse.status);

    const sessionResponse = await fetch(`http://${TEST_HOST}:${port}/api/sessions/seeded-session-1`, {
      headers: AUTH_HEADERS,
    });

    expect(sessionResponse.status).toBe(200);
    const sessionPayload = (await sessionResponse.json()) as SessionDetailsResponse;
    expect(
      sessionPayload.messages.some((message) =>
        message.role === 'user'
        && message.content.includes(uploaded.id)
      )
    ).toBe(true);
  });
});
