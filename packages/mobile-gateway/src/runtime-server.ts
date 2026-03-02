import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import type {
  AttachmentDTO,
  CreateSessionOptionsDTO,
  PairingConfirmResponse,
  PairingStartResponse,
  PermissionModeDTO,
  SessionCommandDTO,
  SessionEventDTO,
  SessionStatusDTO,
  SendMessageOptionsDTO,
  TokenRefreshResponse,
  WorkspaceDTO,
} from '@craft-agent/mobile-contracts';

import { createGatewayServer, type GatewayServer } from './gateway-server.ts';
import { paginateMessages, serializeSession, serializeSessionEvent, type GatewaySessionEventLike, type GatewaySessionLike } from './session-serializers.ts';

const DEFAULT_PORT = 7842;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_VERSION = '0.0.0';
const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_PAIRING_CODE_TTL_MS = 5 * 60_000;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * 60_000;
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const VALID_PERMISSION_MODES: PermissionModeDTO[] = ['safe', 'ask', 'allow-all'];
const MESSAGE_SEND_ACCEPTED_STATUS = 202;
const ATTACHMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

type WorkingDirectoryOption = CreateSessionOptionsDTO['workingDirectory'];

interface ParsedAttachmentUpload {
  name: string;
  mimeType: string;
  data: Buffer;
}

interface PairingCodeRecord {
  code: string;
  expiresAt: number;
}

interface AccessTokenRecord {
  deviceId: string;
  expiresAt: number;
}

interface RefreshTokenRecord {
  deviceId: string;
  expiresAt: number;
}

type AuthResult =
  | { authorized: true; accessToken: string; deviceId: string }
  | { authorized: false; status: number; code: string; message: string };

export interface RuntimeSendMessageResult {
  status?: 200 | 202;
  events: GatewaySessionEventLike[];
}

export interface RuntimeSessionManager {
  getWorkspaces: () => Promise<WorkspaceDTO[]>;
  getSessions: (workspaceId: string) => Promise<GatewaySessionLike[]>;
  getSession: (sessionId: string) => Promise<GatewaySessionLike | null>;
  createSession: (workspaceId: string, options: CreateSessionOptionsDTO) => Promise<GatewaySessionLike>;
  sendMessage: (sessionId: string, text: string, options: SendMessageOptionsDTO) => Promise<RuntimeSendMessageResult>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  setSessionStatus: (sessionId: string, state: SessionStatusDTO) => Promise<void>;
  markSessionRead: (sessionId: string) => Promise<void>;
  markSessionUnread: (sessionId: string) => Promise<void>;
  setSessionPermissionMode: (sessionId: string, mode: PermissionModeDTO) => Promise<void> | void;
  cancelProcessing: (sessionId: string) => Promise<boolean>;
  killShell: (sessionId: string, shellId: string) => Promise<boolean>;
  deleteSession: (sessionId: string) => Promise<boolean>;
}

export interface RuntimeGatewayServerOptions {
  host?: string;
  port?: number;
  version?: string;
  sessionManager: RuntimeSessionManager;
  sseHeartbeatIntervalMs?: number;
  pairingCodeTtlMs?: number;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
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

function parseAttachmentReferences(input: unknown): string[] | null {
  if (input === undefined || input === null) {
    return [];
  }

  if (!Array.isArray(input)) {
    return null;
  }

  const attachmentIds: string[] = [];
  for (const attachment of input) {
    if (typeof attachment === 'string') {
      if (attachment.trim().length === 0) {
        return null;
      }

      attachmentIds.push(attachment);
      continue;
    }

    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      return null;
    }

    const attachmentRecord = attachment as Record<string, unknown>;
    if (typeof attachmentRecord.id !== 'string' || attachmentRecord.id.trim().length === 0) {
      return null;
    }

    attachmentIds.push(attachmentRecord.id);
  }

  return attachmentIds;
}

function parseSendMessagePayload(input: unknown): { text: string; options: SendMessageOptionsDTO; attachmentIds: string[] } | null {
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

  const attachmentIds = parseAttachmentReferences(candidate.attachments);
  if (!attachmentIds) {
    return null;
  }

  return {
    text,
    options,
    attachmentIds,
  };
}

function buildMessageTextWithAttachmentReferences(
  text: string,
  attachmentIds: string[],
  sessionAttachments: Map<string, AttachmentDTO> | undefined
): string {
  if (attachmentIds.length === 0) {
    return text;
  }

  const lines: string[] = [];
  for (const attachmentId of attachmentIds) {
    const attachment = sessionAttachments?.get(attachmentId);
    const name = attachment?.name ?? 'attachment';
    lines.push(`[attachment:${attachmentId}] ${name}`);
  }

  return `${text}\n\n${lines.join('\n')}`;
}

function normalizeMimeType(mimeType: string): string {
  return mimeType
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';
}

function isSupportedAttachmentMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf' || mimeType.startsWith('text/');
}

function getContentTypeHeader(request: IncomingMessage): string {
  const header = request.headers['content-type'];

  if (Array.isArray(header)) {
    return header[0] ?? '';
  }

  return header ?? '';
}

async function readRequestBodyBuffer(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

function parseMultipartAttachment(buffer: Buffer, contentTypeHeader: string): ParsedAttachmentUpload | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    return null;
  }

  const body = buffer.toString('latin1');
  const parts = body.split(`--${boundary}`);

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (trimmedPart.length === 0 || trimmedPart === '--') {
      continue;
    }

    const normalizedPart = part.startsWith('\r\n') ? part.slice(2) : part;
    const separatorIndex = normalizedPart.indexOf('\r\n\r\n');
    if (separatorIndex < 0) {
      continue;
    }

    const headerText = normalizedPart.slice(0, separatorIndex);
    const bodyText = normalizedPart.slice(separatorIndex + 4).replace(/\r\n$/, '');

    const dispositionLine = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-disposition:'));
    if (!dispositionLine) {
      continue;
    }

    const filenameMatch = /filename="([^"]*)"/i.exec(dispositionLine);
    if (!filenameMatch) {
      continue;
    }

    const filename = filenameMatch[1] ?? '';
    const contentTypeLine = headerText
      .split('\r\n')
      .find((line) => line.toLowerCase().startsWith('content-type:'));

    const mimeType = contentTypeLine
      ? contentTypeLine.split(':').slice(1).join(':').trim()
      : 'application/octet-stream';

    return {
      name: filename,
      mimeType,
      data: Buffer.from(bodyText, 'latin1'),
    };
  }

  return null;
}

function parseBase64AttachmentPayload(payload: unknown): ParsedAttachmentUpload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidate = payload as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name : null;
  const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType : null;
  const base64Data = typeof candidate.data === 'string' ? candidate.data : null;

  if (!name || name.trim().length === 0 || !mimeType || mimeType.trim().length === 0 || !base64Data) {
    return null;
  }

  const normalizedBase64 = base64Data.replace(/\s+/g, '');
  if (normalizedBase64.length === 0 || normalizedBase64.length % 4 !== 0 || !BASE64_PATTERN.test(normalizedBase64)) {
    return null;
  }

  const data = Buffer.from(normalizedBase64, 'base64');
  if (data.length === 0) {
    return null;
  }

  return {
    name,
    mimeType,
    data,
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

function parsePairConfirmPayload(input: unknown): { pairingId: string; code: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.pairingId !== 'string' || candidate.pairingId.trim().length === 0) {
    return null;
  }

  if (typeof candidate.code !== 'string' || candidate.code.trim().length === 0) {
    return null;
  }

  return {
    pairingId: candidate.pairingId,
    code: candidate.code,
  };
}

function parseTokenRefreshPayload(input: unknown): { refreshToken: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.refreshToken !== 'string' || candidate.refreshToken.trim().length === 0) {
    return null;
  }

  return {
    refreshToken: candidate.refreshToken,
  };
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

function createSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function createOpaqueToken(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || !token) {
    return null;
  }

  if (scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}

function requireAuth(
  authorizationHeader: string | undefined,
  accessTokens: Map<string, AccessTokenRecord>
): AuthResult {
  const accessToken = parseBearerToken(authorizationHeader);
  if (!accessToken) {
    return {
      authorized: false,
      status: 401,
      code: 'unauthorized',
      message: 'Authorization required',
    };
  }

  const tokenRecord = accessTokens.get(accessToken);
  if (!tokenRecord) {
    return {
      authorized: false,
      status: 401,
      code: 'unauthorized',
      message: 'Authorization required',
    };
  }

  if (tokenRecord.expiresAt <= Date.now()) {
    accessTokens.delete(accessToken);
    return {
      authorized: false,
      status: 401,
      code: 'token_expired',
      message: 'Access token expired',
    };
  }

  return {
    authorized: true,
    accessToken,
    deviceId: tokenRecord.deviceId,
  };
}

async function workspaceExists(sessionManager: RuntimeSessionManager, workspaceId: string): Promise<boolean> {
  const workspaces = await sessionManager.getWorkspaces();
  return workspaces.some((workspace) => workspace.id === workspaceId);
}

function toSessionDTO(
  session: GatewaySessionLike,
  includeMessages = false,
  cursor = 0,
  limit: number | null = null
): { sessionDto: ReturnType<typeof serializeSession>; hasMore?: boolean; nextCursor?: string | null } {
  if (!includeMessages) {
    return {
      sessionDto: serializeSession(session),
    };
  }

  const messagePage = paginateMessages(session.messages ?? [], { cursor, limit });
  const sessionDto = serializeSession(session, {
    includeMessages: true,
    messages: messagePage.messages,
  });

  return {
    sessionDto,
    hasMore: messagePage.hasMore,
    nextCursor: messagePage.nextCursor,
  };
}

export function createRuntimeGatewayServer(options: RuntimeGatewayServerOptions): GatewayServer {
  const sessionManager = options.sessionManager;
  const version = options.version ?? DEFAULT_VERSION;
  const heartbeatIntervalMs = options.sseHeartbeatIntervalMs ?? DEFAULT_SSE_HEARTBEAT_INTERVAL_MS;
  const pairingCodeTtlMs = options.pairingCodeTtlMs ?? DEFAULT_PAIRING_CODE_TTL_MS;
  const accessTokenTtlMs = options.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
  const refreshTokenTtlMs = options.refreshTokenTtlMs ?? DEFAULT_REFRESH_TOKEN_TTL_MS;
  const sseClientsByWorkspace = new Map<string, Set<ServerResponse>>();
  const sseClientsByDevice = new Map<string, Set<ServerResponse>>();
  const sseClientMetadata = new Map<ServerResponse, { workspaceId: string; deviceId: string }>();
  const sessionWorkspaceCache = new Map<string, string>();
  const attachmentsBySession = new Map<string, Map<string, AttachmentDTO>>();
  const pairingCodes = new Map<string, PairingCodeRecord>();
  const accessTokens = new Map<string, AccessTokenRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();

  const addClient = (workspaceId: string, deviceId: string, response: ServerResponse): void => {
    const workspaceClients = sseClientsByWorkspace.get(workspaceId) ?? new Set<ServerResponse>();
    workspaceClients.add(response);
    sseClientsByWorkspace.set(workspaceId, workspaceClients);

    const deviceClients = sseClientsByDevice.get(deviceId) ?? new Set<ServerResponse>();
    deviceClients.add(response);
    sseClientsByDevice.set(deviceId, deviceClients);

    sseClientMetadata.set(response, { workspaceId, deviceId });
  };

  const removeClient = (response: ServerResponse): void => {
    const metadata = sseClientMetadata.get(response);
    if (!metadata) {
      return;
    }

    sseClientMetadata.delete(response);

    const workspaceClients = sseClientsByWorkspace.get(metadata.workspaceId);
    if (workspaceClients) {
      workspaceClients.delete(response);
      if (workspaceClients.size === 0) {
        sseClientsByWorkspace.delete(metadata.workspaceId);
      }
    }

    const deviceClients = sseClientsByDevice.get(metadata.deviceId);
    if (deviceClients) {
      deviceClients.delete(response);
      if (deviceClients.size === 0) {
        sseClientsByDevice.delete(metadata.deviceId);
      }
    }
  };

  const writeSseEvent = (response: ServerResponse, type: string, payload: unknown): void => {
    response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const cleanupResponse = (response: ServerResponse): void => {
    removeClient(response);
    if (!response.writableEnded) {
      response.end();
    }
  };

  const revokeDevice = (deviceId: string): void => {
    for (const [accessToken, tokenRecord] of accessTokens.entries()) {
      if (tokenRecord.deviceId === deviceId) {
        accessTokens.delete(accessToken);
      }
    }

    for (const [refreshToken, refreshRecord] of refreshTokens.entries()) {
      if (refreshRecord.deviceId === deviceId) {
        refreshTokens.delete(refreshToken);
      }
    }

    const deviceClients = sseClientsByDevice.get(deviceId);
    if (!deviceClients) {
      return;
    }

    for (const response of [...deviceClients]) {
      cleanupResponse(response);
    }
  };

  const heartbeatTimer = setInterval(() => {
    for (const responses of sseClientsByWorkspace.values()) {
      for (const response of responses) {
        if (response.destroyed || response.writableEnded) {
          removeClient(response);
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

    const session = await sessionManager.getSession(event.sessionId);
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
        removeClient(response);
        continue;
      }

      writeSseEvent(response, event.type, event);
    }

    if (event.type === 'session_deleted') {
      sessionWorkspaceCache.delete(event.sessionId);
    }
  };

  const issueAccessToken = (deviceId: string): { accessToken: string; expiresAt: number } => {
    const accessToken = createOpaqueToken('at');
    const expiresAt = Date.now() + accessTokenTtlMs;
    accessTokens.set(accessToken, {
      deviceId,
      expiresAt,
    });

    return {
      accessToken,
      expiresAt,
    };
  };

  const issueRefreshToken = (deviceId: string): string => {
    const refreshToken = createOpaqueToken('rt');
    refreshTokens.set(refreshToken, {
      deviceId,
      expiresAt: Date.now() + refreshTokenTtlMs,
    });
    return refreshToken;
  };

  const gatewayServer = createGatewayServer({
    host: options.host ?? DEFAULT_HOST,
    port: options.port ?? DEFAULT_PORT,
    sessionManager: {
      getWorkspaces: sessionManager.getWorkspaces,
    },
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
        method: 'POST',
        path: '/api/pair/start',
        handler: ({ json }) => {
          const pairingId = `pair_${randomUUID()}`;
          const code = createSixDigitCode();
          const expiresAt = Date.now() + pairingCodeTtlMs;

          pairingCodes.set(pairingId, {
            code,
            expiresAt,
          });

          const payload: PairingStartResponse = {
            pairingId,
            code,
            expiresAt,
          };

          json(200, payload);
        },
      },
      {
        method: 'POST',
        path: '/api/pair/confirm',
        handler: async ({ parseJsonBody, error, json }) => {
          const payload = await parseJsonBody<unknown>();
          const pairConfirmPayload = parsePairConfirmPayload(payload);

          if (!pairConfirmPayload) {
            error(400, 'invalid_request', 'pairingId and code are required');
            return;
          }

          const pairingCodeRecord = pairingCodes.get(pairConfirmPayload.pairingId);
          if (!pairingCodeRecord) {
            error(401, 'invalid_pairing_code', 'Pairing code is invalid');
            return;
          }

          if (pairingCodeRecord.expiresAt <= Date.now()) {
            pairingCodes.delete(pairConfirmPayload.pairingId);
            error(410, 'pairing_code_expired', 'Pairing code has expired');
            return;
          }

          if (pairingCodeRecord.code !== pairConfirmPayload.code) {
            error(401, 'invalid_pairing_code', 'Pairing code is invalid');
            return;
          }

          pairingCodes.delete(pairConfirmPayload.pairingId);

          const deviceId = `device_${randomUUID()}`;
          const { accessToken, expiresAt } = issueAccessToken(deviceId);
          const refreshToken = issueRefreshToken(deviceId);

          const response: PairingConfirmResponse = {
            accessToken,
            refreshToken,
            expiresAt,
            deviceId,
          };

          json(200, response);
        },
      },
      {
        method: 'POST',
        path: '/api/pair/refresh',
        handler: async ({ parseJsonBody, error, json }) => {
          const payload = await parseJsonBody<unknown>();
          const refreshPayload = parseTokenRefreshPayload(payload);

          if (!refreshPayload) {
            error(400, 'invalid_request', 'refreshToken is required');
            return;
          }

          const refreshRecord = refreshTokens.get(refreshPayload.refreshToken);
          if (!refreshRecord || refreshRecord.expiresAt <= Date.now()) {
            if (refreshRecord) {
              refreshTokens.delete(refreshPayload.refreshToken);
            }

            error(401, 'invalid_refresh_token', 'Refresh token is invalid or expired');
            return;
          }

          const tokenResponse: TokenRefreshResponse = issueAccessToken(refreshRecord.deviceId);
          json(200, tokenResponse);
        },
      },
      {
        method: 'POST',
        path: '/api/devices/:deviceId/revoke',
        handler: async ({ req, params, error, json }) => {
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
            return;
          }

          const deviceId = params.deviceId;
          if (!deviceId) {
            error(400, 'invalid_request', 'deviceId is required');
            return;
          }

          revokeDevice(deviceId);

          json(200, {
            status: 'ok',
          });
        },
      },
      {
        method: 'GET',
        path: '/api/workspaces',
        handler: async ({ req, error, json }) => {
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
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

          addClient(workspaceId, auth.deviceId, res);

          const onClose = (): void => {
            cleanupResponse(res);
          };

          req.once('close', onClose);
          res.once('close', onClose);
        },
      },
      {
        method: 'GET',
        path: '/api/workspaces/:workspaceId/sessions',
        handler: async ({ req, params, error, json }) => {
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
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

          const session = await sessionManager.getSession(sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const paginated = toSessionDTO(session, true, pagination.cursor, pagination.limit);
          json(200, {
            ...paginated.sessionDto,
            hasMore: paginated.hasMore,
            nextCursor: paginated.nextCursor,
          });
        },
      },
      {
        method: 'POST',
        path: '/api/sessions/:sessionId/attachments',
        handler: async ({ req, params, parseJsonBody, error, json }) => {
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const session = await sessionManager.getSession(sessionId);
          if (!session) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const contentTypeHeader = getContentTypeHeader(req);

          let parsedUpload: ParsedAttachmentUpload | null = null;
          if (contentTypeHeader.toLowerCase().startsWith('multipart/form-data')) {
            const bodyBuffer = await readRequestBodyBuffer(req);
            parsedUpload = parseMultipartAttachment(bodyBuffer, contentTypeHeader);
          } else {
            const payload = await parseJsonBody<unknown>();
            parsedUpload = parseBase64AttachmentPayload(payload);
          }

          if (!parsedUpload || parsedUpload.name.trim().length === 0 || parsedUpload.data.length === 0) {
            error(400, 'invalid_request', 'Attachment file is required');
            return;
          }

          const normalizedMimeType = normalizeMimeType(parsedUpload.mimeType);
          if (!isSupportedAttachmentMimeType(normalizedMimeType)) {
            error(415, 'unsupported_media_type', 'Attachment MIME type is not supported');
            return;
          }

          if (parsedUpload.data.length > ATTACHMENT_MAX_SIZE_BYTES) {
            error(413, 'payload_too_large', 'Attachment exceeds maximum allowed size');
            return;
          }

          const attachment: AttachmentDTO = {
            id: `att_${randomUUID()}`,
            name: parsedUpload.name,
            mimeType: normalizedMimeType,
            size: parsedUpload.data.length,
          };

          sessionWorkspaceCache.set(sessionId, session.workspaceId);
          const sessionAttachments = attachmentsBySession.get(sessionId) ?? new Map<string, AttachmentDTO>();
          sessionAttachments.set(attachment.id, attachment);
          attachmentsBySession.set(sessionId, sessionAttachments);

          json(201, attachment);
        },
      },
      {
        method: 'POST',
        path: '/api/sessions/:sessionId/messages',
        handler: async ({ req, params, parseJsonBody, error, json }) => {
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const session = await sessionManager.getSession(sessionId);
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

          const sessionAttachments = attachmentsBySession.get(sessionId);
          for (const attachmentId of sendMessagePayload.attachmentIds) {
            if (!sessionAttachments?.has(attachmentId)) {
              error(400, 'invalid_request', 'Attachment reference is invalid');
              return;
            }
          }

          const messageText = buildMessageTextWithAttachmentReferences(
            sendMessagePayload.text,
            sendMessagePayload.attachmentIds,
            sessionAttachments
          );

          sessionWorkspaceCache.set(sessionId, session.workspaceId);

          const sendResult = await sessionManager.sendMessage(
            sessionId,
            messageText,
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const session = await sessionManager.getSession(sessionId);
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const session = await sessionManager.getSession(sessionId);
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
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

          const session = await sessionManager.getSession(sessionId);
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
          const auth = requireAuth(req.headers.authorization, accessTokens);
          if (!auth.authorized) {
            error(auth.status, auth.code, auth.message);
            return;
          }

          const sessionId = params.sessionId;
          if (!sessionId) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          const existingSession = await sessionManager.getSession(sessionId);
          if (existingSession) {
            sessionWorkspaceCache.set(existingSession.id, existingSession.workspaceId);
          }

          const deleted = await sessionManager.deleteSession(sessionId);
          if (!deleted) {
            error(404, 'session_not_found', 'Session not found');
            return;
          }

          attachmentsBySession.delete(sessionId);

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

      for (const response of [...sseClientMetadata.keys()]) {
        cleanupResponse(response);
      }

      await originalStop();
    },
  };
}
