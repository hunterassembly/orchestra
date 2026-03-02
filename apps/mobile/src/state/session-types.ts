import type {
  CredentialRequestDTO,
  InfoLevelDTO,
  MessageDTO,
  SessionDTO,
  TypedErrorDTO,
} from "@craft-agent/mobile-contracts";

export type SessionMessage = MessageDTO & {
  turnId?: string;
  parentToolUseId?: string;
  infoLevel?: InfoLevelDTO;
  statusType?: "compacting" | "compaction_complete";
  typedError?: TypedErrorDTO;
  shellId?: string;
};

export type StreamingState = {
  content: string;
  turnId?: string;
  parentToolUseId?: string;
  messageId: string;
};

export type SessionMetadata = {
  isFlagged: boolean;
};

export type SessionRecord = {
  session: SessionDTO;
  messages: SessionMessage[];
  permissionRequests: import("@craft-agent/mobile-contracts").PermissionRequestDTO[];
  credentialRequests: CredentialRequestDTO[];
  streaming: StreamingState | null;
  sessionMetadata: SessionMetadata;
};

export type SessionsSnapshot = {
  activeWorkspaceId: string | null;
  sessionsById: Record<string, SessionRecord>;
  sessionOrder: string[];
};

export function createPlaceholderSession(
  sessionId: string,
  workspaceId: string | null,
): SessionDTO {
  return {
    id: sessionId,
    workspaceId: workspaceId ?? "unknown",
    name: null,
    lastMessageAt: Date.now(),
    isProcessing: false,
    sessionStatus: null,
    hasUnread: false,
    permissionMode: null,
    labels: [],
    preview: null,
    messageCount: 0,
    tokenUsage: null,
  };
}

export function createSessionRecord(
  session: SessionDTO,
  messages: SessionMessage[] = [],
): SessionRecord {
  return {
    session: {
      ...session,
      messageCount: messages.length,
      messages,
    },
    messages,
    permissionRequests: [],
    credentialRequests: [],
    streaming: null,
    sessionMetadata: {
      isFlagged: false,
    },
  };
}
