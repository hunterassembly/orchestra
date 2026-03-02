import type { ServerResponse } from 'node:http';
import type { ErrorDTO } from '@craft-agent/mobile-contracts';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function json(response: ServerResponse, status: number, payload: unknown): void {
  if (response.writableEnded) {
    return;
  }

  response.statusCode = status;
  response.setHeader('content-type', JSON_CONTENT_TYPE);
  response.end(JSON.stringify(payload));
}

export function error(response: ServerResponse, status: number, code: string, message: string): void {
  const payload: ErrorDTO = {
    code,
    message,
  };

  json(response, status, payload);
}

export function noContent(response: ServerResponse, status = 204): void {
  if (response.writableEnded) {
    return;
  }

  response.statusCode = status;
  response.end();
}
