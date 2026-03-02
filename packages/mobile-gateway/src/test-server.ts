import type { ServerResponse } from 'node:http';
import type {
  CreateSessionOptionsDTO,
  MessageDTO,
  PermissionModeDTO,
  SessionCommandDTO,
  SessionStatusDTO,
  SendMessageOptionsDTO,
  SessionEventDTO,
  TokenUsageDTO,
  WorkspaceDTO,
} from '@craft-agent/mobile-contracts';

import {
  createGatewayServer,
  paginateMessages,
  serializeSessionEvent,
  serializeSession,
  type GatewaySessionEventLike,
  type GatewayServer,
  type GatewaySessionLike,
  type GatewaySessionManager,
} from './index.ts';

type WorkingDirectoryOption = CreateSessionOptionsDTO['workingDirectory'];

export interface MockSession extends GatewaySessionLike {
  workingDirectory?: WorkingDirectoryOption;
  activeShellIds?: string[];
}

export interface MockSessionManagerHooks {
  onCreateSession?: (workspaceId: string, options: CreateSessionOptionsDTO) => void;
  onDeleteSession?: (sessionId: string) => void;
  onSendMessage?: (sessionId: string, text: string, options: SendMessageOptionsDTO) => void;
  onCancelProcessing?: (sessionId: string) => void;
  onKillShell?: (sessionId: string, shellId: string) => void;
  onRenameSession?: (sessionId: string, name: string) => void;
  onSetSessionStatus?: (sessionId: string, state: SessionStatusDTO) => void;
  onMarkSessionRead?: (sessionId: string) => void;
  onMarkSessionUnread?: (sessionId: string) => void;
  onSetSessionPermissionMode?: (sessionId: string, mode: PermissionModeDTO) => void;
}

export interface MockSendMessageResult {
  status?: 200 | 202;
  events: GatewaySessionEventLike[];
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
  sendMessage: (sessionId: string, text: string, options: SendMessageOptionsDTO) => Promise<MockSendMessageResult>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  setSessionStatus: (sessionId: string, state: SessionStatusDTO) => Promise<void>;
  markSessionRead: (sessionId: string) => Promise<void>;
  markSessionUnread: (sessionId: string) => Promise<void>;
  setSessionPermissionMode: (sessionId: string, mode: PermissionModeDTO) => Promise<void>;
  cancelProcessing: (sessionId: string) => Promise<boolean>;
  killShell: (sessionId: string, shellId: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
}

export interface TestServerOptions {
  host?: string;
  port?: number;
  version?: string;
  sessionManager?: MockSessionManager;
  sseHeartbeatIntervalMs?: number;
}

const DEFAULT_PORT = 7842;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_VERSION = '0.0.0';
const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 30_000;
const VALID_PERMISSION_MODES: PermissionModeDTO[] = ['safe', 'ask', 'allow-all'];
const MESSAGE_SEND_ACCEPTED_STATUS = 202;

function createDefaultSeededSessions(workspaceId: string): MockSession[] {
  return [
    {
      id: 'seeded-session-1',
      workspaceId,
      name: 'Seeded Session',
      lastMessageAt: 1710000000100,
      isProcessing: false,
      sessionStatus: null,
      hasUnread: false,
      permissionMode: 'ask',
      labels: [],
      preview: 'Seeded assistant reply',
      messageCount: 2,
      tokenUsage: null,
      activeShellIds: [],
      messages: [
        {
          id: 'seeded-message-1',
          role: 'user',
          content: 'Seeded user message',
          timestamp: 1710000000000,
        },
        {
          id: 'seeded-message-2',
          role: 'assistant',
          content: 'Seeded assistant reply',
          timestamp: 1710000000100,
        },
      ],
    },
  ];
}

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

function parseSendMessageOptions(input: unknown): SendMessageOptionsDTO | null {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const options: SendMessageOptionsDTO = {};

  if (candidate.optimisticMessageId !== undefined) {
    if (typeof candidate.optimisticMessageId !== 'string' || candidate.optimisticMessageId.trim().length === 0) {
      return null;
    }

    options.optimisticMessageId = candidate.optimisticMessageId;
  }

  if (candidate.ultrathinkEnabled !== undefined) {
    if (typeof candidate.ultrathinkEnabled !== 'boolean') {
      return null;
    }

    options.ultrathinkEnabled = candidate.ultrathinkEnabled;
  }

  if (candidate.skillSlugs !== undefined) {
    if (!Array.isArray(candidate.skillSlugs)) {
      return null;
    }

    const skillSlugs = candidate.skillSlugs
      .map((skillSlug) => (typeof skillSlug === 'string' ? skillSlug.trim() : ''));

    if (skillSlugs.some((skillSlug) => skillSlug.length === 0)) {
      return null;
    }

    options.skillSlugs = skillSlugs;
  }

  return options;
}

function parseSendMessagePayload(input: unknown): { text: string; options: SendMessageOptionsDTO } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;

  const topLevelText = typeof candidate.text === 'string' ? candidate.text : null;
  const topLevelMessage = typeof candidate.message === 'string'
    ? candidate.message
    : null;
  const nestedMessageContent = candidate.message && typeof candidate.message === 'object' && !Array.isArray(candidate.message)
    ? (candidate.message as Record<string, unknown>).content
    : null;
  const nestedText = typeof nestedMessageContent === 'string' ? nestedMessageContent : null;

  const text = topLevelText ?? topLevelMessage ?? nestedText;
  if (!text || text.trim().length === 0) {
    return null;
  }

  const options = parseSendMessageOptions(candidate.options);
  if (!options) {
    return null;
  }

  return {
    text,
    options,
  };
}

function parseSessionCommand(input: unknown):
  | { command: SessionCommandDTO }
  | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Session command payload must be an object' };
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.type !== 'string') {
    return { error: 'Session command type is required' };
  }

  switch (candidate.type) {
    case 'rename': {
      if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
        return { error: 'rename command requires a non-empty name' };
      }

      return {
        command: {
          type: 'rename',
          name: candidate.name,
        },
      };
    }

    case 'setSessionStatus': {
      if (typeof candidate.state !== 'string' || candidate.state.trim().length === 0) {
        return { error: 'setSessionStatus command requires a non-empty state' };
      }

      return {
        command: {
          type: 'setSessionStatus',
          state: candidate.state,
        },
      };
    }

    case 'markRead':
      return {
        command: {
          type: 'markRead',
        },
      };

    case 'markUnread':
      return {
        command: {
          type: 'markUnread',
        },
      };

    case 'setPermissionMode': {
      if (typeof candidate.mode !== 'string' || !VALID_PERMISSION_MODES.includes(candidate.mode as PermissionModeDTO)) {
        return { error: 'setPermissionMode command requires a valid mode' };
      }

      return {
        command: {
          type: 'setPermissionMode',
          mode: candidate.mode as PermissionModeDTO,
        },
      };
    }

    default:
      return { error: 'Unknown command type' };
  }
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

function createUserMessage(sessionId: string, text: string, counter: number): MessageDTO {
  const now = Date.now();

  return {
    id: `${sessionId}-user-${counter}`,
    role: 'user',
    content: text,
    timestamp: now,
    toolName: null,
    toolUseId: null,
    toolInput: null,
    toolResult: null,
    toolStatus: null,
    isStreaming: false,
    isPending: false,
    isIntermediate: false,
  };
}

function createMockTokenUsage(): TokenUsageDTO {
  return {
    inputTokens: 12,
    outputTokens: 18,
    totalTokens: 30,
    contextTokens: 300,
    costUsd: 0.0003,
  };
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
  const seededSessions = normalizedOptions.sessions
    ?? createDefaultSeededSessions(seededWorkspaces[0]?.id ?? 'default');

  for (const session of seededSessions) {
    sessionsById.set(session.id, cloneSession(session));
    workspaceIds.add(session.workspaceId);
  }

  let nextSessionCounter = sessionsById.size + 1;
  let nextMessageCounter = 1;
  let nextToolCounter = 1;

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
        activeShellIds: [],
        messages: [],
      };

      nextSessionCounter += 1;
      sessionsById.set(session.id, cloneSession(session));

      return cloneSession(session);
    },
    async sendMessage(sessionId: string, text: string, options: SendMessageOptionsDTO) {
      const session = sessionsById.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      hooks?.onSendMessage?.(sessionId, text, options);

      const userMessage = createUserMessage(sessionId, text, nextMessageCounter);
      nextMessageCounter += 1;

      const toolUseId = `tool-${nextToolCounter}`;
      nextToolCounter += 1;

      const assistantText = `Simulated response for: ${text}`;
      const tokenUsage = createMockTokenUsage();
      const assistantTimestamp = Date.now();
      const assistantMessage: MessageDTO = {
        id: `${sessionId}-assistant-${nextMessageCounter}`,
        role: 'assistant',
        content: assistantText,
        timestamp: assistantTimestamp,
        toolName: null,
        toolUseId: null,
        toolInput: null,
        toolResult: null,
        toolStatus: null,
        isStreaming: false,
        isPending: false,
        isIntermediate: false,
      };
      nextMessageCounter += 1;

      const existingMessages = session.messages ? [...session.messages] : [];
      existingMessages.push(userMessage, assistantMessage);

      const updatedSession: MockSession = {
        ...session,
        messages: existingMessages,
        lastMessageAt: assistantTimestamp,
        preview: assistantText,
        messageCount: existingMessages.length,
        tokenUsage,
      };

      sessionsById.set(sessionId, updatedSession);

      return {
        status: MESSAGE_SEND_ACCEPTED_STATUS,
        events: [
          {
            type: 'user_message',
            sessionId,
            message: userMessage,
            status: 'accepted',
            optimisticMessageId: options.optimisticMessageId,
          },
          {
            type: 'text_delta',
            sessionId,
            delta: 'Simulated response ',
          },
          {
            type: 'tool_start',
            sessionId,
            toolName: 'bash',
            toolUseId,
            toolInput: {
              command: 'echo "ok"',
            },
          },
          {
            type: 'tool_result',
            sessionId,
            toolUseId,
            toolName: 'bash',
            result: 'ok',
          },
          {
            type: 'text_complete',
            sessionId,
            text: assistantText,
          },
          {
            type: 'complete',
            sessionId,
            tokenUsage,
          },
        ],
      };
    },
    async renameSession(sessionId: string, name: string) {
      hooks?.onRenameSession?.(sessionId, name);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return;
      }

      sessionsById.set(sessionId, {
        ...session,
        name,
      });
    },
    async setSessionStatus(sessionId: string, state: SessionStatusDTO) {
      hooks?.onSetSessionStatus?.(sessionId, state);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return;
      }

      sessionsById.set(sessionId, {
        ...session,
        sessionStatus: state,
      });
    },
    async markSessionRead(sessionId: string) {
      hooks?.onMarkSessionRead?.(sessionId);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return;
      }

      sessionsById.set(sessionId, {
        ...session,
        hasUnread: false,
      });
    },
    async markSessionUnread(sessionId: string) {
      hooks?.onMarkSessionUnread?.(sessionId);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return;
      }

      sessionsById.set(sessionId, {
        ...session,
        hasUnread: true,
      });
    },
    async setSessionPermissionMode(sessionId: string, mode: PermissionModeDTO) {
      hooks?.onSetSessionPermissionMode?.(sessionId, mode);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return;
      }

      sessionsById.set(sessionId, {
        ...session,
        permissionMode: mode,
      });
    },
    async cancelProcessing(sessionId: string) {
      hooks?.onCancelProcessing?.(sessionId);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return false;
      }

      if (!session.isProcessing) {
        return false;
      }

      const updatedSession: MockSession = {
        ...session,
        isProcessing: false,
      };

      sessionsById.set(sessionId, updatedSession);
      return true;
    },
    async killShell(sessionId: string, shellId: string) {
      hooks?.onKillShell?.(sessionId, shellId);

      const session = sessionsById.get(sessionId);
      if (!session) {
        return false;
      }

      const activeShellIds = session.activeShellIds ?? [];
      if (!activeShellIds.includes(shellId)) {
        return false;
      }

      const updatedSession: MockSession = {
        ...session,
        activeShellIds: activeShellIds.filter((id) => id !== shellId),
      };

      sessionsById.set(sessionId, updatedSession);
      return true;
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
  const heartbeatIntervalMs = options.sseHeartbeatIntervalMs ?? DEFAULT_SSE_HEARTBEAT_INTERVAL_MS;
  const sseClientsByWorkspace = new Map<string, Set<ServerResponse>>();
  const sessionWorkspaceCache = new Map<string, string>();

  const addClient = (workspaceId: string, response: ServerResponse): void => {
    const workspaceClients = sseClientsByWorkspace.get(workspaceId) ?? new Set<ServerResponse>();
    workspaceClients.add(response);
    sseClientsByWorkspace.set(workspaceId, workspaceClients);
  };

  const removeClient = (workspaceId: string, response: ServerResponse): void => {
    const workspaceClients = sseClientsByWorkspace.get(workspaceId);
    if (!workspaceClients) {
      return;
    }

    workspaceClients.delete(response);
    if (workspaceClients.size === 0) {
      sseClientsByWorkspace.delete(workspaceId);
    }
  };

  const writeSseEvent = (response: ServerResponse, type: string, payload: unknown): void => {
    response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const cleanupResponse = (workspaceId: string, response: ServerResponse): void => {
    removeClient(workspaceId, response);
    if (!response.writableEnded) {
      response.end();
    }
  };

  const heartbeatTimer = setInterval(() => {
    for (const [workspaceId, responses] of sseClientsByWorkspace.entries()) {
      for (const response of responses) {
        if (response.destroyed || response.writableEnded) {
          removeClient(workspaceId, response);
          continue;
        }

        writeSseEvent(response, 'ping', { type: 'ping' });
      }
    }
  }, heartbeatIntervalMs);

  const resolveSessionWorkspaceId = async (event: SessionEventDTO): Promise<string | null> => {
    const cachedWorkspaceId = sessionWorkspaceCache.get(event.sessionId);
    if (cachedWorkspaceId) {
      return cachedWorkspaceId;
    }

    const session = await getSessionOrNull(sessionManager, event.sessionId);
    if (!session) {
      return null;
    }

    sessionWorkspaceCache.set(event.sessionId, session.workspaceId);
    return session.workspaceId;
  };

  const fanoutEvent = async (event: SessionEventDTO): Promise<void> => {
    const workspaceId = await resolveSessionWorkspaceId(event);
    if (!workspaceId) {
      return;
    }

    const workspaceClients = sseClientsByWorkspace.get(workspaceId);
    if (!workspaceClients || workspaceClients.size === 0) {
      return;
    }

    for (const response of workspaceClients) {
      if (response.destroyed || response.writableEnded) {
        removeClient(workspaceId, response);
        continue;
      }

      writeSseEvent(response, event.type, event);
    }

    if (event.type === 'session_deleted') {
      sessionWorkspaceCache.delete(event.sessionId);
    }
  };

  const gatewayServer = createGatewayServer({
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
        path: '/api/workspaces/:workspaceId/events',
        handler: async ({ req, res, params, error }) => {
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

          const workspaceSessions = await sessionManager.getSessions(workspaceId);
          for (const session of workspaceSessions) {
            sessionWorkspaceCache.set(session.id, workspaceId);
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.flushHeaders();
          res.socket?.setKeepAlive(true);
          res.socket?.setTimeout(0);

          addClient(workspaceId, res);

          const onClose = (): void => {
            cleanupResponse(workspaceId, res);
          };

          req.once('close', onClose);
          res.once('close', onClose);
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
          for (const session of sessions) {
            sessionWorkspaceCache.set(session.id, workspaceId);
          }

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
          sessionWorkspaceCache.set(createdSession.id, workspaceId);

          void fanoutEvent({
            type: 'session_created',
            sessionId: createdSession.id,
          });

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
        method: 'POST',
        path: '/api/sessions/:sessionId/messages',
        handler: async ({ req, params, parseJsonBody, error, json }) => {
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

          const session = await getSessionOrNull(sessionManager, sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const payload = await parseJsonBody<unknown>();
          const sendMessagePayload = parseSendMessagePayload(payload);

          if (!sendMessagePayload) {
            error(400, 'invalid_request', 'Message text is required');
            return;
          }

          sessionWorkspaceCache.set(sessionId, session.workspaceId);

          const sendResult = await sessionManager.sendMessage(
            sessionId,
            sendMessagePayload.text,
            sendMessagePayload.options
          );

          for (const rawEvent of sendResult.events) {
            const serializedEvent = serializeSessionEvent(rawEvent);
            if (!serializedEvent) {
              continue;
            }

            await fanoutEvent(serializedEvent);
          }

          json(sendResult.status ?? MESSAGE_SEND_ACCEPTED_STATUS, {
            status: 'accepted',
          });
        },
      },
      {
        method: 'POST',
        path: '/api/sessions/:sessionId/commands',
        handler: async ({ req, params, parseJsonBody, error, json }) => {
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

          const session = await getSessionOrNull(sessionManager, sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const payload = await parseJsonBody<unknown>();
          const commandResult = parseSessionCommand(payload);

          if ('error' in commandResult) {
            error(400, 'invalid_request', commandResult.error);
            return;
          }

          sessionWorkspaceCache.set(sessionId, session.workspaceId);

          switch (commandResult.command.type) {
            case 'rename': {
              await sessionManager.renameSession(sessionId, commandResult.command.name);
              await fanoutEvent({
                type: 'name_changed',
                sessionId,
                name: commandResult.command.name,
              });
              break;
            }

            case 'setSessionStatus': {
              await sessionManager.setSessionStatus(sessionId, commandResult.command.state);
              await fanoutEvent({
                type: 'session_status_changed',
                sessionId,
                sessionStatus: commandResult.command.state,
              });
              break;
            }

            case 'markRead': {
              await sessionManager.markSessionRead(sessionId);
              break;
            }

            case 'markUnread': {
              await sessionManager.markSessionUnread(sessionId);
              break;
            }

            case 'setPermissionMode': {
              await sessionManager.setSessionPermissionMode(sessionId, commandResult.command.mode);
              await fanoutEvent({
                type: 'permission_mode_changed',
                sessionId,
                permissionMode: commandResult.command.mode,
              });
              break;
            }
          }

          json(200, {
            status: 'ok',
          });
        },
      },
      {
        method: 'POST',
        path: '/api/sessions/:sessionId/interrupt',
        handler: async ({ req, params, error, json }) => {
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

          const session = await getSessionOrNull(sessionManager, sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          sessionWorkspaceCache.set(sessionId, session.workspaceId);

          const wasInterrupted = await sessionManager.cancelProcessing(sessionId);
          if (wasInterrupted) {
            await fanoutEvent({
              type: 'interrupted',
              sessionId,
            });
          }

          json(200, {
            status: 'ok',
          });
        },
      },
      {
        method: 'POST',
        path: '/api/sessions/:sessionId/shells/:shellId/kill',
        handler: async ({ req, params, error, json }) => {
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

          const shellId = params.shellId;
          if (!shellId) {
            error(404, 'shell_not_found', 'Shell not found');
            return;
          }

          const session = await getSessionOrNull(sessionManager, sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          sessionWorkspaceCache.set(sessionId, session.workspaceId);

          const didKill = await sessionManager.killShell(sessionId, shellId);
          if (!didKill) {
            error(404, 'shell_not_found', 'Shell not found');
            return;
          }

          await fanoutEvent({
            type: 'shell_killed',
            sessionId,
            shellId,
          });

          json(200, {
            status: 'ok',
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

          const existingSession = await getSessionOrNull(sessionManager, sessionId);
          if (existingSession) {
            sessionWorkspaceCache.set(existingSession.id, existingSession.workspaceId);
          }

          const deleted = await sessionManager.deleteSession(sessionId);
          if (!deleted) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          void fanoutEvent({
            type: 'session_deleted',
            sessionId,
          });

          noContent(204);
        },
      },
    ],
  });

  const unsubscribeBroadcast = gatewayServer.onBroadcast((event) => {
    void fanoutEvent(event);
  });

  const originalStop = gatewayServer.stop;

  return {
    ...gatewayServer,
    stop: async () => {
      unsubscribeBroadcast();
      clearInterval(heartbeatTimer);

      for (const [workspaceId, responses] of sseClientsByWorkspace.entries()) {
        for (const response of responses) {
          cleanupResponse(workspaceId, response);
        }
      }

      await originalStop();
    },
  };
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
