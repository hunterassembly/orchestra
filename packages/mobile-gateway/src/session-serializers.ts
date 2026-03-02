import type {
  CredentialInputModeDTO,
  CredentialRequestDTO,
  CreateSessionOptionsDTO,
  InfoLevelDTO,
  MessageDTO,
  PermissionModeDTO,
  PermissionRequestDTO,
  RecoveryActionDTO,
  SessionEventDTO,
  SessionDTO,
  SessionUserMessageEventDTO,
  TokenUsageDTO,
  TypedErrorDTO,
} from '@craft-agent/mobile-contracts';

type WorkingDirectoryOption = CreateSessionOptionsDTO['workingDirectory'];

const PERMISSION_MODES = new Set<PermissionModeDTO>(['safe', 'ask', 'allow-all']);
const INFO_LEVELS = new Set<InfoLevelDTO>(['info', 'warning', 'error', 'success']);
const PERMISSION_REQUEST_TYPES = new Set<NonNullable<PermissionRequestDTO['type']>>([
  'bash',
  'file_write',
  'mcp_mutation',
  'api_mutation',
]);
const CREDENTIAL_INPUT_MODES = new Set<CredentialInputModeDTO>([
  'bearer',
  'basic',
  'header',
  'query',
  'multi-header',
]);
const RECOVERY_ACTION_TYPES = new Set<NonNullable<RecoveryActionDTO['action']>>(['retry', 'settings', 'reauth']);

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

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function sanitizeStatusType(value: unknown): 'compacting' | undefined {
  return value === 'compacting' ? value : undefined;
}

function sanitizeInfoStatusType(value: unknown): 'compaction_complete' | undefined {
  return value === 'compaction_complete' ? value : undefined;
}

function sanitizeInfoLevel(value: unknown): InfoLevelDTO | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return INFO_LEVELS.has(value as InfoLevelDTO) ? (value as InfoLevelDTO) : undefined;
}

function sanitizeTypedError(value: unknown): TypedErrorDTO | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return null;
  }

  const typedError: TypedErrorDTO = {
    code: candidate.code,
    message: candidate.message,
  };

  const title = toOptionalString(candidate.title);
  if (title !== undefined) {
    typedError.title = title;
  }

  if (typeof candidate.canRetry === 'boolean') {
    typedError.canRetry = candidate.canRetry;
  }

  const retryDelayMs = toOptionalNumber(candidate.retryDelayMs);
  if (retryDelayMs !== undefined) {
    typedError.retryDelayMs = retryDelayMs;
  }

  if (Array.isArray(candidate.details)) {
    const details = candidate.details.filter((detail): detail is string => typeof detail === 'string');
    if (details.length > 0) {
      typedError.details = details;
    }
  }

  const originalError = toOptionalString(candidate.originalError);
  if (originalError !== undefined) {
    typedError.originalError = originalError;
  }

  if (Array.isArray(candidate.actions)) {
    const actions = candidate.actions
      .map((action) => {
        if (!action || typeof action !== 'object' || Array.isArray(action)) {
          return null;
        }

        const actionCandidate = action as Record<string, unknown>;
        if (typeof actionCandidate.key !== 'string' || typeof actionCandidate.label !== 'string') {
          return null;
        }

        const recoveryAction: RecoveryActionDTO = {
          key: actionCandidate.key,
          label: actionCandidate.label,
        };

        const command = toOptionalString(actionCandidate.command);
        if (command !== undefined) {
          recoveryAction.command = command;
        }

        if (
          typeof actionCandidate.action === 'string'
          && RECOVERY_ACTION_TYPES.has(actionCandidate.action as NonNullable<RecoveryActionDTO['action']>)
        ) {
          recoveryAction.action = actionCandidate.action as NonNullable<RecoveryActionDTO['action']>;
        }

        return recoveryAction;
      })
      .filter((action): action is RecoveryActionDTO => action !== null);

    if (actions.length > 0) {
      typedError.actions = actions;
    }
  }

  return typedError;
}

function sanitizePermissionRequest(value: unknown): PermissionRequestDTO | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.requestId !== 'string'
    || typeof candidate.toolName !== 'string'
    || typeof candidate.description !== 'string'
  ) {
    return null;
  }

  const request: PermissionRequestDTO = {
    requestId: candidate.requestId,
    toolName: candidate.toolName,
    description: candidate.description,
  };

  const command = toOptionalString(candidate.command);
  if (command !== undefined) {
    request.command = command;
  }

  if (typeof candidate.type === 'string' && PERMISSION_REQUEST_TYPES.has(candidate.type as NonNullable<PermissionRequestDTO['type']>)) {
    request.type = candidate.type as NonNullable<PermissionRequestDTO['type']>;
  }

  return request;
}

function sanitizeCredentialRequest(value: unknown): CredentialRequestDTO | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.requestId !== 'string') {
    return null;
  }

  const request: CredentialRequestDTO = {
    requestId: candidate.requestId,
  };

  const sourceSlug = toOptionalString(candidate.sourceSlug);
  if (sourceSlug !== undefined) {
    request.sourceSlug = sourceSlug;
  }

  const sourceName = toOptionalString(candidate.sourceName);
  if (sourceName !== undefined) {
    request.sourceName = sourceName;
  }

  if (typeof candidate.inputMode === 'string' && CREDENTIAL_INPUT_MODES.has(candidate.inputMode as CredentialInputModeDTO)) {
    request.inputMode = candidate.inputMode as CredentialInputModeDTO;
  }

  const headerName = toOptionalString(candidate.headerName);
  if (headerName !== undefined) {
    request.headerName = headerName;
  }

  if (Array.isArray(candidate.headerNames)) {
    const headerNames = candidate.headerNames.filter((header): header is string => typeof header === 'string');
    if (headerNames.length > 0) {
      request.headerNames = headerNames;
    }
  }

  if (candidate.labels && typeof candidate.labels === 'object' && !Array.isArray(candidate.labels)) {
    const labelsCandidate = candidate.labels as Record<string, unknown>;
    const labels: NonNullable<CredentialRequestDTO['labels']> = {};

    const credential = toOptionalString(labelsCandidate.credential);
    if (credential !== undefined) {
      labels.credential = credential;
    }

    const username = toOptionalString(labelsCandidate.username);
    if (username !== undefined) {
      labels.username = username;
    }

    const password = toOptionalString(labelsCandidate.password);
    if (password !== undefined) {
      labels.password = password;
    }

    if (Object.keys(labels).length > 0) {
      request.labels = labels;
    }
  }

  const description = toOptionalString(candidate.description);
  if (description !== undefined) {
    request.description = description;
  }

  const hint = toOptionalString(candidate.hint);
  if (hint !== undefined) {
    request.hint = hint;
  }

  const sourceUrl = toOptionalString(candidate.sourceUrl);
  if (sourceUrl !== undefined) {
    request.sourceUrl = sourceUrl;
  }

  if (typeof candidate.passwordRequired === 'boolean') {
    request.passwordRequired = candidate.passwordRequired;
  }

  return request;
}

function sanitizeUsageUpdateTokenUsage(value: unknown): {
  inputTokens: number;
  contextWindow?: number;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const tokenUsage: {
    inputTokens: number;
    contextWindow?: number;
  } = {
    inputTokens: toNumber(candidate.inputTokens, 0),
  };

  const contextWindow = toOptionalNumber(candidate.contextWindow);
  if (contextWindow !== undefined) {
    tokenUsage.contextWindow = contextWindow;
  }

  return tokenUsage;
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

    case 'status': {
      const statusType = sanitizeStatusType(event.statusType);

      return {
        type: 'status',
        sessionId,
        message: typeof event.message === 'string' ? event.message : '',
        ...(statusType !== undefined ? { statusType } : {}),
      };
    }

    case 'info': {
      const statusType = sanitizeInfoStatusType(event.statusType);
      const level = sanitizeInfoLevel(event.level);
      const timestamp = toOptionalNumber(event.timestamp);

      return {
        type: 'info',
        sessionId,
        message: typeof event.message === 'string' ? event.message : '',
        ...(statusType !== undefined ? { statusType } : {}),
        ...(level !== undefined ? { level } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
      };
    }

    case 'error': {
      const timestamp = toOptionalNumber(event.timestamp);

      return {
        type: 'error',
        sessionId,
        error: typeof event.error === 'string'
          ? event.error
          : (typeof event.message === 'string' ? event.message : ''),
        ...(timestamp !== undefined ? { timestamp } : {}),
      };
    }

    case 'typed_error': {
      const typedError = sanitizeTypedError(event.error);
      if (!typedError) {
        return null;
      }

      const timestamp = toOptionalNumber(event.timestamp);

      return {
        type: 'typed_error',
        sessionId,
        error: typedError,
        ...(timestamp !== undefined ? { timestamp } : {}),
      };
    }

    case 'permission_request': {
      const request = sanitizePermissionRequest(event.request);
      if (!request) {
        return null;
      }

      return {
        type: 'permission_request',
        sessionId,
        request,
      };
    }

    case 'credential_request': {
      const request = sanitizeCredentialRequest(event.request);
      if (!request) {
        return null;
      }

      return {
        type: 'credential_request',
        sessionId,
        request,
      };
    }

    case 'usage_update': {
      const tokenUsage = sanitizeUsageUpdateTokenUsage(event.tokenUsage);
      if (!tokenUsage) {
        return null;
      }

      return {
        type: 'usage_update',
        sessionId,
        tokenUsage,
      };
    }

    case 'session_created': {
      const parentSessionId = toOptionalString(event.parentSessionId);

      return {
        type: 'session_created',
        sessionId,
        ...(parentSessionId !== undefined ? { parentSessionId } : {}),
      };
    }

    case 'session_deleted': {
      return {
        type: 'session_deleted',
        sessionId,
      };
    }

    case 'session_status_changed': {
      const statusCandidate = typeof event.sessionStatus === 'string'
        ? event.sessionStatus
        : (typeof event.state === 'string' ? event.state : '');

      return {
        type: 'session_status_changed',
        sessionId,
        sessionStatus: statusCandidate,
      };
    }

    case 'name_changed': {
      const name = toOptionalString(event.name);

      return {
        type: 'name_changed',
        sessionId,
        ...(name !== undefined ? { name } : {}),
      };
    }

    case 'session_flagged': {
      return {
        type: 'session_flagged',
        sessionId,
      };
    }

    case 'session_unflagged': {
      return {
        type: 'session_unflagged',
        sessionId,
      };
    }

    case 'permission_mode_changed': {
      if (
        event.permissionMode !== 'safe'
        && event.permissionMode !== 'ask'
        && event.permissionMode !== 'allow-all'
      ) {
        return null;
      }

      return {
        type: 'permission_mode_changed',
        sessionId,
        permissionMode: event.permissionMode,
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
