import type {
  CreateSessionOptionsDTO,
  MessageDTO,
  PermissionModeDTO,
  SessionEventDTO,
  SessionDTO,
  SessionUserMessageEventDTO,
  TokenUsageDTO,
} from '@craft-agent/mobile-contracts';

type WorkingDirectoryOption = CreateSessionOptionsDTO['workingDirectory'];

const PERMISSION_MODES = new Set<PermissionModeDTO>(['safe', 'ask', 'allow-all']);

export interface GatewayMessageLike {
  id: string;
  role: MessageDTO['role'];
  content?: string | null;
  timestamp?: number | string | Date | null;
  toolName?: string | null;
  toolUseId?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolResult?: string | null;
  toolStatus?: MessageDTO['toolStatus'];
  isStreaming?: boolean;
  isPending?: boolean;
  isIntermediate?: boolean;
}

export interface GatewaySessionLike {
  id: string;
  workspaceId: string;
  name?: string | null;
  workingDirectory?: WorkingDirectoryOption;
  lastMessageAt?: number | string | Date | null;
  isProcessing?: boolean;
  sessionStatus?: string | null;
  hasUnread?: boolean;
  permissionMode?: PermissionModeDTO | null;
  labels?: string[];
  preview?: string | null;
  messageCount?: number;
  tokenUsage?: Partial<TokenUsageDTO> | null;
  messages?: GatewayMessageLike[];
}

export interface GatewaySessionEventLike {
  type: string;
  sessionId: string;
  [key: string]: unknown;
}

export interface PaginatedMessagesDTO {
  messages: MessageDTO[];
  hasMore: boolean;
  nextCursor: string | null;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  return toNumber(value, 0);
}

function sanitizeTokenUsage(value: GatewaySessionLike['tokenUsage']): TokenUsageDTO | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const tokenUsage: TokenUsageDTO = {
    inputTokens: toNumber(value.inputTokens, 0),
    outputTokens: toNumber(value.outputTokens, 0),
    totalTokens: toNumber(value.totalTokens, 0),
    contextTokens: toNumber(value.contextTokens, 0),
    costUsd: toNumber(value.costUsd, 0),
  };

  const cacheReadTokens = toOptionalNumber(value.cacheReadTokens);
  if (cacheReadTokens !== undefined) {
    tokenUsage.cacheReadTokens = cacheReadTokens;
  }

  const cacheCreationTokens = toOptionalNumber(value.cacheCreationTokens);
  if (cacheCreationTokens !== undefined) {
    tokenUsage.cacheCreationTokens = cacheCreationTokens;
  }

  const contextWindow = toOptionalNumber(value.contextWindow);
  if (contextWindow !== undefined) {
    tokenUsage.contextWindow = contextWindow;
  }

  return tokenUsage;
}

function sanitizePermissionMode(value: GatewaySessionLike['permissionMode']): PermissionModeDTO | null {
  if (!value) {
    return null;
  }

  return PERMISSION_MODES.has(value) ? value : null;
}

function sanitizeUserMessageStatus(value: unknown): SessionUserMessageEventDTO['status'] {
  if (value === 'queued' || value === 'processing') {
    return value;
  }

  return 'accepted';
}

export function serializeMessage(message: GatewayMessageLike): MessageDTO {
  return {
    id: message.id,
    role: message.role,
    content: message.content ?? '',
    timestamp: toNumber(message.timestamp, 0),
    toolName: message.toolName ?? null,
    toolUseId: message.toolUseId ?? null,
    toolInput: message.toolInput ?? null,
    toolResult: message.toolResult ?? null,
    toolStatus: message.toolStatus ?? null,
    isStreaming: message.isStreaming ?? false,
    isPending: message.isPending ?? false,
    isIntermediate: message.isIntermediate ?? false,
  };
}

export function serializeSession(
  session: GatewaySessionLike,
  options?: {
    includeMessages?: boolean;
    messages?: MessageDTO[];
  }
): SessionDTO {
  const serializedMessages = (session.messages ?? []).map((message) => serializeMessage(message));
  const responseMessages = options?.messages ?? serializedMessages;
  const fallbackLastMessageAt = responseMessages.length > 0 ? responseMessages[responseMessages.length - 1]?.timestamp ?? 0 : 0;

  const dto: SessionDTO = {
    id: session.id,
    workspaceId: session.workspaceId,
    name: session.name ?? null,
    lastMessageAt: toNumber(session.lastMessageAt, fallbackLastMessageAt),
    isProcessing: session.isProcessing ?? false,
    sessionStatus: session.sessionStatus ?? null,
    hasUnread: session.hasUnread ?? false,
    permissionMode: sanitizePermissionMode(session.permissionMode),
    labels: Array.isArray(session.labels) ? [...session.labels] : [],
    preview: session.preview ?? null,
    messageCount: Number.isInteger(session.messageCount) && (session.messageCount ?? 0) >= 0
      ? (session.messageCount as number)
      : serializedMessages.length,
    tokenUsage: sanitizeTokenUsage(session.tokenUsage ?? null),
  };

  if (session.workingDirectory !== undefined && session.workingDirectory !== null) {
    dto.workingDirectory = session.workingDirectory;
  }

  if (options?.includeMessages) {
    dto.messages = responseMessages;
  }

  return dto;
}

export function paginateMessages(
  messages: GatewayMessageLike[],
  options: {
    limit: number | null;
    cursor: number;
  }
): PaginatedMessagesDTO {
  const serializedMessages = messages.map((message) => serializeMessage(message));
  const startIndex = Math.max(0, options.cursor);

  const endIndex = options.limit === null
    ? serializedMessages.length
    : Math.min(serializedMessages.length, startIndex + options.limit);

  const paginatedMessages = serializedMessages.slice(startIndex, endIndex);
  const hasMore = endIndex < serializedMessages.length;

  return {
    messages: paginatedMessages,
    hasMore,
    nextCursor: hasMore ? String(endIndex) : null,
  };
}

export function serializeSessionEvent(event: GatewaySessionEventLike): SessionEventDTO | null {
  const sessionId = typeof event.sessionId === 'string' ? event.sessionId : '';
  if (!sessionId) {
    return null;
  }

  switch (event.type) {
    case 'text_delta': {
      const delta = typeof event.delta === 'string' ? event.delta : '';
      return {
        type: 'text_delta',
        sessionId,
        delta,
      };
    }

    case 'text_complete': {
      const text = typeof event.text === 'string' ? event.text : '';
      return {
        type: 'text_complete',
        sessionId,
        text,
      };
    }

    case 'tool_start': {
      const toolUseId = typeof event.toolUseId === 'string' ? event.toolUseId : '';
      if (!toolUseId) {
        return null;
      }

      const toolInputCandidate = event.toolInput;
      const toolInput = toolInputCandidate && typeof toolInputCandidate === 'object' && !Array.isArray(toolInputCandidate)
        ? (toolInputCandidate as Record<string, unknown>)
        : {};

      return {
        type: 'tool_start',
        sessionId,
        toolName: typeof event.toolName === 'string' ? event.toolName : 'unknown',
        toolUseId,
        toolInput,
      };
    }

    case 'tool_result': {
      const toolUseId = typeof event.toolUseId === 'string' ? event.toolUseId : '';
      if (!toolUseId) {
        return null;
      }

      return {
        type: 'tool_result',
        sessionId,
        toolUseId,
        toolName: typeof event.toolName === 'string' ? event.toolName : 'unknown',
        result: typeof event.result === 'string' ? event.result : '',
        isError: event.isError === true ? true : undefined,
      };
    }

    case 'complete': {
      const tokenUsage = sanitizeTokenUsage((event.tokenUsage as Partial<TokenUsageDTO> | null | undefined) ?? null);
      return {
        type: 'complete',
        sessionId,
        tokenUsage: tokenUsage ?? undefined,
      };
    }

    case 'user_message': {
      const messageCandidate = event.message;
      if (!messageCandidate || typeof messageCandidate !== 'object') {
        return null;
      }

      const optimisticMessageId = typeof event.optimisticMessageId === 'string' && event.optimisticMessageId.length > 0
        ? event.optimisticMessageId
        : undefined;

      return {
        type: 'user_message',
        sessionId,
        message: serializeMessage(messageCandidate as GatewayMessageLike),
        status: sanitizeUserMessageStatus(event.status),
        optimisticMessageId,
      };
    }

    default:
      return null;
  }
}
