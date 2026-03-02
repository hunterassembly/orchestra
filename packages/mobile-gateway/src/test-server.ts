import type { CreateSessionOptionsDTO, PermissionModeDTO, WorkspaceDTO } from '@craft-agent/mobile-contracts';

import {
  createGatewayServer,
  paginateMessages,
  serializeSession,
  type GatewayServer,
  type GatewaySessionLike,
  type GatewaySessionManager,
} from './index.ts';

type WorkingDirectoryOption = CreateSessionOptionsDTO['workingDirectory'];

export interface MockSession extends GatewaySessionLike {
  workingDirectory?: WorkingDirectoryOption;
}

export interface MockSessionManagerHooks {
  onCreateSession?: (workspaceId: string, options: CreateSessionOptionsDTO) => void;
  onDeleteSession?: (sessionId: string) => void;
}

export interface CreateMockSessionManagerOptions {
  workspaces?: WorkspaceDTO[];
  sessions?: MockSession[];
  hooks?: MockSessionManagerHooks;
}

export interface MockSessionManager extends GatewaySessionManager {
  getWorkspaces: () => Promise<WorkspaceDTO[]>;
  getSessions: (workspaceId: string) => Promise<MockSession[]>;
  getSession: (sessionId: string) => Promise<MockSession | null>;
  createSession: (workspaceId: string, options: CreateSessionOptionsDTO) => Promise<MockSession>;
  deleteSession: (sessionId: string) => Promise<boolean>;
}

export interface TestServerOptions {
  host?: string;
  port?: number;
  version?: string;
  sessionManager?: MockSessionManager;
}

const DEFAULT_PORT = 7842;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_VERSION = '0.0.0';
const VALID_PERMISSION_MODES: PermissionModeDTO[] = ['safe', 'ask', 'allow-all'];

function cloneSession(session: MockSession): MockSession {
  return structuredClone(session);
}

function parseCreateSessionOptions(input: unknown): CreateSessionOptionsDTO | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const options: CreateSessionOptionsDTO = {};

  if (candidate.name !== undefined) {
    if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
      return null;
    }
    options.name = candidate.name;
  }

  if (candidate.permissionMode !== undefined) {
    if (typeof candidate.permissionMode !== 'string') {
      return null;
    }

    if (!VALID_PERMISSION_MODES.includes(candidate.permissionMode as PermissionModeDTO)) {
      return null;
    }

    options.permissionMode = candidate.permissionMode as PermissionModeDTO;
  }

  if (candidate.workingDirectory !== undefined) {
    if (typeof candidate.workingDirectory !== 'string' || candidate.workingDirectory.trim().length === 0) {
      return null;
    }
    options.workingDirectory = candidate.workingDirectory as WorkingDirectoryOption;
  }

  return options;
}

function parseSingleQueryParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function parsePagination(query: Record<string, string | string[]>):
  | { cursor: number; limit: number | null }
  | { error: { code: string; message: string } } {
  const rawLimit = parseSingleQueryParam(query.limit);
  const rawCursor = parseSingleQueryParam(query.cursor);

  let limit: number | null = null;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit)) {
      return { error: { code: 'invalid_query', message: 'limit must be a positive integer' } };
    }

    const parsedLimit = Number.parseInt(rawLimit, 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return { error: { code: 'invalid_query', message: 'limit must be a positive integer' } };
    }

    limit = parsedLimit;
  }

  let cursor = 0;
  if (rawCursor !== undefined) {
    if (!/^\d+$/.test(rawCursor)) {
      return { error: { code: 'invalid_query', message: 'cursor must be a non-negative integer' } };
    }

    const parsedCursor = Number.parseInt(rawCursor, 10);
    if (!Number.isInteger(parsedCursor) || parsedCursor < 0) {
      return { error: { code: 'invalid_query', message: 'cursor must be a non-negative integer' } };
    }

    cursor = parsedCursor;
  }

  return {
    cursor,
    limit,
  };
}

function hasValidBearerToken(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) {
    return false;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || !token) {
    return false;
  }

  return scheme.toLowerCase() === 'bearer';
}

function requireAuth(authorizationHeader: string | undefined): { authorized: true } | { authorized: false } {
  if (!hasValidBearerToken(authorizationHeader)) {
    return { authorized: false };
  }

  return { authorized: true };
}

async function workspaceExists(sessionManager: MockSessionManager, workspaceId: string): Promise<boolean> {
  const workspaces = await sessionManager.getWorkspaces();
  return workspaces.some((workspace) => workspace.id === workspaceId);
}

async function getSessionOrNull(sessionManager: MockSessionManager, sessionId: string): Promise<MockSession | null> {
  const session = await sessionManager.getSession(sessionId);
  return session ? cloneSession(session) : null;
}

export function createMockSessionManager(options: CreateMockSessionManagerOptions | WorkspaceDTO[] = {}): MockSessionManager {
  const normalizedOptions = Array.isArray(options)
    ? {
        workspaces: options,
      }
    : options;

  const seededWorkspaces = normalizedOptions.workspaces ?? [
    {
      id: 'default',
      name: 'Default Workspace',
    },
  ];

  const workspaceIds = new Set(seededWorkspaces.map((workspace) => workspace.id));
  const sessionsById = new Map<string, MockSession>();

  for (const session of normalizedOptions.sessions ?? []) {
    sessionsById.set(session.id, cloneSession(session));
    workspaceIds.add(session.workspaceId);
  }

  let nextSessionCounter = sessionsById.size + 1;

  const hooks = normalizedOptions.hooks;

  return {
    async getWorkspaces() {
      return [...seededWorkspaces];
    },
    async getSessions(workspaceId: string) {
      if (!workspaceIds.has(workspaceId)) {
        return [];
      }

      return Array.from(sessionsById.values())
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => cloneSession(session));
    },
    async getSession(sessionId: string) {
      const session = sessionsById.get(sessionId);
      return session ? cloneSession(session) : null;
    },
    async createSession(workspaceId: string, options: CreateSessionOptionsDTO) {
      if (!workspaceIds.has(workspaceId)) {
        throw new Error(`Workspace ${workspaceId} does not exist`);
      }

      hooks?.onCreateSession?.(workspaceId, options);

      const session: MockSession = {
        id: `session-${nextSessionCounter}`,
        workspaceId,
        name: options.name ?? null,
        lastMessageAt: Date.now(),
        isProcessing: false,
        sessionStatus: null,
        hasUnread: false,
        permissionMode: options.permissionMode ?? null,
        labels: [],
        preview: null,
        messageCount: 0,
        tokenUsage: null,
        workingDirectory: options.workingDirectory,
        messages: [],
      };

      nextSessionCounter += 1;
      sessionsById.set(session.id, cloneSession(session));

      return cloneSession(session);
    },
    async deleteSession(sessionId: string) {
      if (!sessionsById.has(sessionId)) {
        return false;
      }

      sessionsById.delete(sessionId);
      hooks?.onDeleteSession?.(sessionId);
      return true;
    },
  };
}

export function createTestServer(options: TestServerOptions = {}): GatewayServer {
  const sessionManager = options.sessionManager ?? createMockSessionManager();
  const version = options.version ?? DEFAULT_VERSION;

  return createGatewayServer({
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    sessionManager,
    routes: [
      {
        method: 'GET',
        path: '/api/health',
        handler: ({ json }) => {
          json(200, {
            status: 'ok',
            version,
          });
        },
      },
      {
        method: 'GET',
        path: '/api/workspaces',
        handler: async ({ req, error, json }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const workspacesResult = await sessionManager.getWorkspaces();
          json(200, workspacesResult);
        },
      },
      {
        method: 'GET',
        path: '/api/workspaces/:workspaceId/sessions',
        handler: async ({ req, params, error, json }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const workspaceId = params.workspaceId;
          if (!workspaceId || !(await workspaceExists(sessionManager, workspaceId))) {
            error(404, 'workspace_not_found', 'Workspace not found');
            return;
          }

          const sessions = await sessionManager.getSessions(workspaceId);
          json(200, sessions.map((session) => serializeSession(session)));
        },
      },
      {
        method: 'POST',
        path: '/api/workspaces/:workspaceId/sessions',
        handler: async ({ req, params, parseJsonBody, error, json }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const workspaceId = params.workspaceId;
          if (!workspaceId || !(await workspaceExists(sessionManager, workspaceId))) {
            error(404, 'workspace_not_found', 'Workspace not found');
            return;
          }

          const payload = await parseJsonBody<unknown>();
          const createSessionOptions = parseCreateSessionOptions(payload);

          if (!createSessionOptions) {
            error(400, 'invalid_request', 'Invalid create session options');
            return;
          }

          const createdSession = await sessionManager.createSession(workspaceId, createSessionOptions);
          json(201, serializeSession(createdSession));
        },
      },
      {
        method: 'GET',
        path: '/api/sessions/:sessionId',
        handler: async ({ req, params, query, error, json }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const pagination = parsePagination(query);
          if ('error' in pagination) {
            error(400, pagination.error.code, pagination.error.message);
            return;
          }

          const session = await getSessionOrNull(sessionManager, sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const messagePage = paginateMessages(session.messages ?? [], pagination);
          const sessionDto = serializeSession(session, {
            includeMessages: true,
            messages: messagePage.messages,
          });

          json(200, {
            ...sessionDto,
            hasMore: messagePage.hasMore,
            nextCursor: messagePage.nextCursor,
          });
        },
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:sessionId',
        handler: async ({ req, params, error, noContent }) => {
          const auth = requireAuth(req.headers.authorization);
          if (!auth.authorized) {
            error(401, 'unauthorized', 'Authorization required');
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const deleted = await sessionManager.deleteSession(sessionId);
          if (!deleted) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          noContent(204);
        },
      },
    ],
  });
}

if (import.meta.main) {
  const configuredPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const server = createTestServer({
    port: Number.isNaN(configuredPort) ? DEFAULT_PORT : configuredPort,
  });

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });

  const { host, port } = await server.start();
  // eslint-disable-next-line no-console
  console.log(`[mobile-gateway:test-server] listening on http://${host}:${port}`);
}
