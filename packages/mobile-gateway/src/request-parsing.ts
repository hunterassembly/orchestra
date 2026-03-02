import type { IncomingMessage } from 'node:http';

export type ParsedQuery = Record<string, string | string[]>;

export class RequestParsingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RequestParsingError';
    this.status = status;
    this.code = code;
  }
}

export async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return '';
  }

  return Buffer.concat(chunks).toString('utf8');
}

export async function parseJsonBody<T>(request: IncomingMessage): Promise<T> {
  const rawBody = await readRequestBody(request);

  if (!rawBody) {
    throw new RequestParsingError(400, 'invalid_json', 'Request body is required');
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    throw new RequestParsingError(400, 'invalid_json', 'Request body must be valid JSON');
  }
}

export function parseQuery(searchParams: URLSearchParams): ParsedQuery {
  const query: ParsedQuery = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
      continue;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }

    query[key] = [existing, value];
  }

  return query;
}
