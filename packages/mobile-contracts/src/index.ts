export type PermissionModeDTO = 'safe' | 'ask' | 'allow-all';

export type SessionStatusDTO = string;

export type MessageRoleDTO =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'error'
  | 'status'
  | 'info'
  | 'warning'
  | 'plan'
  | 'auth-request';

export type ToolStatusDTO = 'pending' | 'executing' | 'completed' | 'error' | 'backgrounded';

export interface TokenUsageDTO {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextWindow?: number;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
}

export interface AttachmentDTO {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ErrorDTO {
  code: string;
  message: string;
}

export interface RecoveryActionDTO {
  key: string;
  label: string;
  command?: string;
  action?: 'retry' | 'settings' | 'reauth';
}

export interface TypedErrorDTO extends ErrorDTO {
  title?: string;
  actions?: RecoveryActionDTO[];
  canRetry?: boolean;
  retryDelayMs?: number;
  details?: string[];
  originalError?: string;
}

export interface MessageDTO {
  id: string;
  role: MessageRoleDTO;
  content: string;
  timestamp: number;
  toolName: string | null;
  toolUseId: string | null;
  toolInput: Record<string, unknown> | null;
  toolResult: string | null;
  toolStatus: ToolStatusDTO | null;
  isStreaming: boolean;
  isPending: boolean;
  isIntermediate: boolean;
}

export interface SessionDTO {
  id: string;
  workspaceId: string;
  name: string | null;
  lastMessageAt: number;
  isProcessing: boolean;
  sessionStatus: SessionStatusDTO | null;
  hasUnread: boolean;
  permissionMode: PermissionModeDTO | null;
  labels: string[];
  preview: string | null;
  messageCount: number;
  tokenUsage: TokenUsageDTO | null;
  messages?: MessageDTO[];
}

export interface CreateSessionOptionsDTO {
  name?: string;
  permissionMode?: PermissionModeDTO;
  workingDirectory?: string | 'user_default' | 'none';
}

export interface SendMessageOptionsDTO {
  optimisticMessageId?: string;
  ultrathinkEnabled?: boolean;
  skillSlugs?: string[];
}

export type SessionCommandDTO =
  | { type: 'rename'; name: string }
  | { type: 'setSessionStatus'; state: SessionStatusDTO }
  | { type: 'markRead' }
  | { type: 'markUnread' }
  | { type: 'setPermissionMode'; mode: PermissionModeDTO };

export interface PairingStartResponse {
  pairingId: string;
  code: string;
  expiresAt: number;
}

export interface PairingConfirmResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  deviceId: string;
}

export interface TokenRefreshResponse {
  accessToken: string;
  expiresAt: number;
}

export interface PermissionRequestDTO {
  requestId: string;
  toolName: string;
  command?: string;
  description: string;
  type?: 'bash' | 'file_write' | 'mcp_mutation' | 'api_mutation';
}

export type CredentialInputModeDTO = 'bearer' | 'basic' | 'header' | 'query' | 'multi-header';

export interface CredentialRequestDTO {
  requestId: string;
  sourceSlug?: string;
  sourceName?: string;
  inputMode?: CredentialInputModeDTO;
  headerName?: string;
  headerNames?: string[];
  labels?: {
    credential?: string;
    username?: string;
    password?: string;
  };
  description?: string;
  hint?: string;
  sourceUrl?: string;
  passwordRequired?: boolean;
}

export type InfoLevelDTO = 'info' | 'warning' | 'error' | 'success';

export const SESSION_EVENT_TYPES = [
  'text_delta',
  'text_complete',
  'tool_start',
  'tool_result',
  'status',
  'info',
  'error',
  'typed_error',
  'complete',
  'interrupted',
  'shell_killed',
  'permission_request',
  'credential_request',
  'user_message',
  'usage_update',
  'session_created',
  'session_deleted',
  'session_status_changed',
  'name_changed',
  'session_flagged',
  'session_unflagged',
  'permission_mode_changed',
] as const;

export type SessionEventTypeDTO = (typeof SESSION_EVENT_TYPES)[number];

export interface SessionTextDeltaEventDTO {
  type: 'text_delta';
  sessionId: string;
  delta: string;
  turnId?: string;
  parentToolUseId?: string;
}

export interface SessionTextCompleteEventDTO {
  type: 'text_complete';
  sessionId: string;
  text: string;
  isIntermediate?: boolean;
  turnId?: string;
  parentToolUseId?: string;
  timestamp?: number;
}

export interface SessionToolStartEventDTO {
  type: 'tool_start';
  sessionId: string;
  toolName: string;
  toolUseId: string;
  toolInput: Record<string, unknown>;
  toolIntent?: string;
  toolDisplayName?: string;
  turnId?: string;
  parentToolUseId?: string;
  timestamp?: number;
}

export interface SessionToolResultEventDTO {
  type: 'tool_result';
  sessionId: string;
  toolUseId: string;
  toolName: string;
  result: string;
  isError?: boolean;
  turnId?: string;
  parentToolUseId?: string;
  timestamp?: number;
}

export interface SessionStatusEventDTO {
  type: 'status';
  sessionId: string;
  message: string;
  statusType?: 'compacting';
}

export interface SessionInfoEventDTO {
  type: 'info';
  sessionId: string;
  message: string;
  statusType?: 'compaction_complete';
  level?: InfoLevelDTO;
  timestamp?: number;
}

export interface SessionErrorEventDTO {
  type: 'error';
  sessionId: string;
  error: string;
  timestamp?: number;
}

export interface SessionTypedErrorEventDTO {
  type: 'typed_error';
  sessionId: string;
  error: TypedErrorDTO;
  timestamp?: number;
}

export interface SessionCompleteEventDTO {
  type: 'complete';
  sessionId: string;
  tokenUsage?: TokenUsageDTO;
  hasUnread?: boolean;
}

export interface SessionInterruptedEventDTO {
  type: 'interrupted';
  sessionId: string;
  message?: MessageDTO;
  queuedMessages?: string[];
}

export interface SessionShellKilledEventDTO {
  type: 'shell_killed';
  sessionId: string;
  shellId: string;
}

export interface SessionPermissionRequestEventDTO {
  type: 'permission_request';
  sessionId: string;
  request: PermissionRequestDTO;
}

export interface SessionCredentialRequestEventDTO {
  type: 'credential_request';
  sessionId: string;
  request: CredentialRequestDTO;
}

export interface SessionUserMessageEventDTO {
  type: 'user_message';
  sessionId: string;
  message: MessageDTO;
  status: 'accepted' | 'queued' | 'processing';
  optimisticMessageId?: string;
}

export interface SessionUsageUpdateEventDTO {
  type: 'usage_update';
  sessionId: string;
  tokenUsage: {
    inputTokens: number;
    contextWindow?: number;
  };
}

export interface SessionCreatedEventDTO {
  type: 'session_created';
  sessionId: string;
  parentSessionId?: string;
}

export interface SessionDeletedEventDTO {
  type: 'session_deleted';
  sessionId: string;
}

export interface SessionStatusChangedEventDTO {
  type: 'session_status_changed';
  sessionId: string;
  sessionStatus: SessionStatusDTO;
}

export interface SessionNameChangedEventDTO {
  type: 'name_changed';
  sessionId: string;
  name?: string;
}

export interface SessionFlaggedEventDTO {
  type: 'session_flagged';
  sessionId: string;
}

export interface SessionUnflaggedEventDTO {
  type: 'session_unflagged';
  sessionId: string;
}

export interface SessionPermissionModeChangedEventDTO {
  type: 'permission_mode_changed';
  sessionId: string;
  permissionMode: PermissionModeDTO;
}

export type SessionEventDTO =
  | SessionTextDeltaEventDTO
  | SessionTextCompleteEventDTO
  | SessionToolStartEventDTO
  | SessionToolResultEventDTO
  | SessionStatusEventDTO
  | SessionInfoEventDTO
  | SessionErrorEventDTO
  | SessionTypedErrorEventDTO
  | SessionCompleteEventDTO
  | SessionInterruptedEventDTO
  | SessionShellKilledEventDTO
  | SessionPermissionRequestEventDTO
  | SessionCredentialRequestEventDTO
  | SessionUserMessageEventDTO
  | SessionUsageUpdateEventDTO
  | SessionCreatedEventDTO
  | SessionDeletedEventDTO
  | SessionStatusChangedEventDTO
  | SessionNameChangedEventDTO
  | SessionFlaggedEventDTO
  | SessionUnflaggedEventDTO
  | SessionPermissionModeChangedEventDTO;
