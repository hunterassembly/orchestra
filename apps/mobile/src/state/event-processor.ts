import type {
  SessionDTO,
  SessionEventDTO,
  TokenUsageDTO,
} from "@craft-agent/mobile-contracts";

import {
  createPlaceholderSession,
  createSessionRecord,
  type SessionMessage,
  type SessionRecord,
  type SessionsSnapshot,
} from "@/state/session-types";

let messageCounter = 0;

function generateMessageId(): string {
  messageCounter += 1;
  return `mobile-msg-${Date.now()}-${messageCounter}`;
}

function cloneRecord(record: SessionRecord): SessionRecord {
  return {
    session: { ...record.session },
    messages: [...record.messages],
    permissionRequests: [...record.permissionRequests],
    credentialRequests: [...record.credentialRequests],
    streaming: record.streaming ? { ...record.streaming } : null,
    sessionMetadata: { ...record.sessionMetadata },
  };
}

function upsertRecord(
  snapshot: SessionsSnapshot,
  sessionId: string,
  record: SessionRecord,
  prepend = false,
): SessionsSnapshot {
  const exists = sessionId in snapshot.sessionsById;
  const nextOrder = exists
    ? [...snapshot.sessionOrder]
    : prepend
      ? [sessionId, ...snapshot.sessionOrder]
      : [...snapshot.sessionOrder, sessionId];

  return {
    ...snapshot,
    sessionsById: {
      ...snapshot.sessionsById,
      [sessionId]: syncDerivedSessionFields(record),
    },
    sessionOrder: nextOrder,
  };
}

function removeRecord(snapshot: SessionsSnapshot, sessionId: string): SessionsSnapshot {
  if (!(sessionId in snapshot.sessionsById)) {
    return snapshot;
  }

  const sessionsById = { ...snapshot.sessionsById };
  delete sessionsById[sessionId];

  return {
    ...snapshot,
    sessionsById,
    sessionOrder: snapshot.sessionOrder.filter((id) => id !== sessionId),
  };
}

function getOrCreateRecord(snapshot: SessionsSnapshot, sessionId: string): SessionRecord {
  const existing = snapshot.sessionsById[sessionId];
  if (existing) {
    return cloneRecord(existing);
  }

  const placeholder = createPlaceholderSession(sessionId, snapshot.activeWorkspaceId);
  return createSessionRecord(placeholder);
}

function findStreamingMessageIndex(messages: SessionMessage[], turnId?: string): number {
  if (turnId) {
    const byTurnId = messages.findIndex(
      (message) => message.role === "assistant" && message.turnId === turnId && message.isStreaming,
    );
    if (byTurnId !== -1) {
      return byTurnId;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.isStreaming) {
      return index;
    }
  }

  return -1;
}

function findAssistantMessageIndex(messages: SessionMessage[], turnId?: string): number {
  if (turnId) {
    const byTurnId = messages.findIndex(
      (message) => message.role === "assistant" && message.turnId === turnId,
    );
    if (byTurnId !== -1) {
      return byTurnId;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.isStreaming) {
      return index;
    }
  }

  return -1;
}

function findToolMessageIndex(messages: SessionMessage[], toolUseId: string): number {
  return messages.findIndex((message) => message.toolUseId === toolUseId);
}

function markRunningToolsComplete(messages: SessionMessage[]): SessionMessage[] {
  return messages.map((message) => {
    if (message.role === "tool" && message.toolStatus === "executing") {
      return { ...message, toolStatus: "completed" as const };
    }

    return message;
  });
}

function markRunningToolsErrored(messages: SessionMessage[]): SessionMessage[] {
  return messages.map((message) => {
    if (
      message.role === "tool" &&
      message.toolStatus !== "completed" &&
      message.toolStatus !== "error"
    ) {
      return {
        ...message,
        toolStatus: "error" as const,
        toolResult: message.toolResult ?? "Error occurred",
      };
    }

    return message;
  });
}

function mergeUsage(
  existing: SessionDTO["tokenUsage"],
  nextInputTokens: number,
  nextContextWindow?: number,
): TokenUsageDTO {
  return {
    inputTokens: nextInputTokens,
    outputTokens: existing?.outputTokens ?? 0,
    totalTokens: existing?.totalTokens ?? 0,
    contextTokens: existing?.contextTokens ?? 0,
    costUsd: existing?.costUsd ?? 0,
    ...(existing?.cacheReadTokens !== undefined && { cacheReadTokens: existing.cacheReadTokens }),
    ...(existing?.cacheCreationTokens !== undefined && {
      cacheCreationTokens: existing.cacheCreationTokens,
    }),
    ...(nextContextWindow !== undefined && { contextWindow: nextContextWindow }),
  };
}

function syncDerivedSessionFields(record: SessionRecord): SessionRecord {
  const previewCandidate = [...record.messages]
    .reverse()
    .find((message) =>
      (message.role === "assistant" || message.role === "user") && message.content.trim().length > 0,
    );

  const hasMessages = record.messages.length > 0;
  const session = {
    ...record.session,
    messageCount: record.messages.length,
    preview: previewCandidate?.content ?? record.session.preview,
    messages: record.messages,
    lastMessageAt: hasMessages
      ? Math.max(record.session.lastMessageAt, record.messages[record.messages.length - 1]?.timestamp ?? 0)
      : record.session.lastMessageAt,
  };

  return {
    ...record,
    session,
  };
}

export function createEmptySessionsSnapshot(
  activeWorkspaceId: string | null = null,
): SessionsSnapshot {
  return {
    activeWorkspaceId,
    sessionsById: {},
    sessionOrder: [],
  };
}

export function processSessionEvent(
  snapshot: SessionsSnapshot,
  event: SessionEventDTO,
): SessionsSnapshot {
  if (event.type === "session_deleted") {
    return removeRecord(snapshot, event.sessionId);
  }

  if (event.type === "session_created") {
    const record = getOrCreateRecord(snapshot, event.sessionId);
    return upsertRecord(snapshot, event.sessionId, record, true);
  }

  const record = getOrCreateRecord(snapshot, event.sessionId);

  switch (event.type) {
    case "text_delta": {
      const streamingIndex = findStreamingMessageIndex(record.messages, event.turnId);

      if (streamingIndex !== -1) {
        const current = record.messages[streamingIndex];
        const updated = {
          ...current,
          content: `${current.content}${event.delta}`,
          turnId: event.turnId ?? current.turnId,
          parentToolUseId: event.parentToolUseId ?? current.parentToolUseId,
          isStreaming: true,
          isPending: true,
        };

        record.messages[streamingIndex] = updated;
        record.streaming = {
          content: updated.content,
          turnId: updated.turnId,
          parentToolUseId: updated.parentToolUseId,
          messageId: updated.id,
        };
      } else {
        const message: SessionMessage = {
          id: generateMessageId(),
          role: "assistant",
          content: event.delta,
          timestamp: Date.now(),
          toolName: null,
          toolUseId: null,
          toolInput: null,
          toolResult: null,
          toolStatus: null,
          isStreaming: true,
          isPending: true,
          isIntermediate: false,
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
        };
        record.messages.push(message);
        record.streaming = {
          content: event.delta,
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
          messageId: message.id,
        };
      }

      record.session.isProcessing = true;
      break;
    }

    case "text_complete": {
      let messageIndex = findAssistantMessageIndex(record.messages, event.turnId);
      if (messageIndex === -1 && record.streaming) {
        messageIndex = record.messages.findIndex((message) => message.id === record.streaming?.messageId);
      }

      if (messageIndex === -1) {
        record.messages.push({
          id: generateMessageId(),
          role: "assistant",
          content: event.text,
          timestamp: event.timestamp ?? Date.now(),
          toolName: null,
          toolUseId: null,
          toolInput: null,
          toolResult: null,
          toolStatus: null,
          isStreaming: false,
          isPending: false,
          isIntermediate: Boolean(event.isIntermediate),
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
        });
      } else {
        const current = record.messages[messageIndex];
        record.messages[messageIndex] = {
          ...current,
          content: event.text,
          timestamp: event.timestamp ?? current.timestamp,
          isStreaming: false,
          isPending: false,
          isIntermediate: Boolean(event.isIntermediate),
          turnId: event.turnId ?? current.turnId,
          parentToolUseId: event.parentToolUseId ?? current.parentToolUseId,
        };
      }

      if (!event.isIntermediate) {
        record.session.lastMessageAt = event.timestamp ?? Date.now();
      }

      record.streaming = null;
      break;
    }

    case "tool_start": {
      const existingToolIndex = findToolMessageIndex(record.messages, event.toolUseId);
      if (existingToolIndex !== -1) {
        const current = record.messages[existingToolIndex];
        record.messages[existingToolIndex] = {
          ...current,
          toolName: event.toolName,
          toolInput: event.toolInput,
          toolStatus: "executing",
          turnId: event.turnId ?? current.turnId,
          parentToolUseId: event.parentToolUseId ?? current.parentToolUseId,
          timestamp: event.timestamp ?? current.timestamp,
        };
      } else {
        record.messages.push({
          id: generateMessageId(),
          role: "tool",
          content: "",
          timestamp: event.timestamp ?? Date.now(),
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          toolInput: event.toolInput,
          toolResult: null,
          toolStatus: "executing",
          isStreaming: false,
          isPending: false,
          isIntermediate: false,
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
        });
      }

      record.session.isProcessing = true;
      break;
    }

    case "tool_result": {
      const toolIndex = findToolMessageIndex(record.messages, event.toolUseId);
      if (toolIndex !== -1) {
        const current = record.messages[toolIndex];
        record.messages[toolIndex] = {
          ...current,
          toolName: event.toolName,
          toolResult: event.result,
          toolStatus: "completed",
          timestamp: event.timestamp ?? current.timestamp,
          turnId: event.turnId ?? current.turnId,
          parentToolUseId: event.parentToolUseId ?? current.parentToolUseId,
        };
      } else {
        record.messages.push({
          id: generateMessageId(),
          role: "tool",
          content: "",
          timestamp: event.timestamp ?? Date.now(),
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          toolInput: null,
          toolResult: event.result,
          toolStatus: "completed",
          isStreaming: false,
          isPending: false,
          isIntermediate: false,
          turnId: event.turnId,
          parentToolUseId: event.parentToolUseId,
        });
      }
      break;
    }

    case "status": {
      record.messages.push({
        id: generateMessageId(),
        role: "status",
        content: event.message,
        timestamp: Date.now(),
        toolName: null,
        toolUseId: null,
        toolInput: null,
        toolResult: null,
        toolStatus: null,
        isStreaming: false,
        isPending: false,
        isIntermediate: false,
        statusType: event.statusType,
      });
      record.session.isProcessing = true;
      break;
    }

    case "info": {
      record.messages.push({
        id: generateMessageId(),
        role: "info",
        content: event.message,
        timestamp: event.timestamp ?? Date.now(),
        toolName: null,
        toolUseId: null,
        toolInput: null,
        toolResult: null,
        toolStatus: null,
        isStreaming: false,
        isPending: false,
        isIntermediate: false,
        statusType: event.statusType,
        infoLevel: event.level,
      });
      break;
    }

    case "error": {
      record.messages = markRunningToolsErrored(record.messages);
      record.messages.push({
        id: generateMessageId(),
        role: "error",
        content: event.error,
        timestamp: event.timestamp ?? Date.now(),
        toolName: null,
        toolUseId: null,
        toolInput: null,
        toolResult: null,
        toolStatus: null,
        isStreaming: false,
        isPending: false,
        isIntermediate: false,
      });
      record.session.isProcessing = false;
      record.streaming = null;
      break;
    }

    case "typed_error": {
      record.messages = markRunningToolsErrored(record.messages);
      record.messages.push({
        id: generateMessageId(),
        role: "error",
        content: event.error.title
          ? `${event.error.title}: ${event.error.message}`
          : event.error.message,
        timestamp: event.timestamp ?? Date.now(),
        toolName: null,
        toolUseId: null,
        toolInput: null,
        toolResult: null,
        toolStatus: null,
        isStreaming: false,
        isPending: false,
        isIntermediate: false,
        typedError: event.error,
      });
      record.session.isProcessing = false;
      record.streaming = null;
      break;
    }

    case "complete": {
      record.messages = markRunningToolsComplete(record.messages);
      record.session.isProcessing = false;
      record.streaming = null;
      if (event.tokenUsage) {
        record.session.tokenUsage = event.tokenUsage;
      }
      if (event.hasUnread !== undefined) {
        record.session.hasUnread = event.hasUnread;
      }
      break;
    }

    case "interrupted": {
      record.session.isProcessing = false;
      record.streaming = null;
      record.messages = record.messages.map((message) => {
        if (message.role === "assistant" && message.isPending) {
          return {
            ...message,
            isPending: false,
            isStreaming: false,
          };
        }

        if (
          message.role === "tool" &&
          message.toolStatus !== "completed" &&
          message.toolStatus !== "error"
        ) {
          return {
            ...message,
            toolStatus: "error",
            toolResult: message.toolResult ?? "Interrupted",
          };
        }

        return message;
      });

      if (event.message) {
        record.messages.push(event.message);
      }

      break;
    }

    case "shell_killed": {
      record.messages.push({
        id: generateMessageId(),
        role: "info",
        content: `Shell ${event.shellId} killed`,
        timestamp: Date.now(),
        toolName: null,
        toolUseId: null,
        toolInput: null,
        toolResult: null,
        toolStatus: null,
        isStreaming: false,
        isPending: false,
        isIntermediate: false,
        shellId: event.shellId,
      });
      break;
    }

    case "permission_request": {
      const alreadyQueued = record.permissionRequests.some(
        (request) => request.requestId === event.request.requestId,
      );
      if (!alreadyQueued) {
        record.permissionRequests.push(event.request);
      }
      break;
    }

    case "credential_request": {
      const alreadyQueued = record.credentialRequests.some(
        (request) => request.requestId === event.request.requestId,
      );
      if (!alreadyQueued) {
        record.credentialRequests.push(event.request);
      }
      break;
    }

    case "user_message": {
      const existingIndex = record.messages.findIndex(
        (message) =>
          message.role === "user" &&
          (message.id === event.message.id ||
            (event.optimisticMessageId && message.id === event.optimisticMessageId) ||
            (message.content === event.message.content &&
              Math.abs(message.timestamp - event.message.timestamp) < 5_000)),
      );

      const normalizedMessage: SessionMessage = {
        ...event.message,
        isPending: event.status === "queued",
      };

      if (existingIndex !== -1) {
        record.messages[existingIndex] = {
          ...record.messages[existingIndex],
          ...normalizedMessage,
        };
      } else {
        record.messages.push(normalizedMessage);
      }

      record.session.lastMessageAt = normalizedMessage.timestamp;
      record.session.isProcessing = event.status === "accepted" || event.status === "processing";
      break;
    }

    case "usage_update": {
      record.session.tokenUsage = mergeUsage(
        record.session.tokenUsage,
        event.tokenUsage.inputTokens,
        event.tokenUsage.contextWindow,
      );
      break;
    }

    case "session_status_changed": {
      record.session.sessionStatus = event.sessionStatus;
      break;
    }

    case "name_changed": {
      record.session.name = event.name ?? null;
      break;
    }

    case "session_flagged": {
      record.sessionMetadata.isFlagged = true;
      break;
    }

    case "session_unflagged": {
      record.sessionMetadata.isFlagged = false;
      break;
    }

    case "permission_mode_changed": {
      record.session.permissionMode = event.permissionMode;
      break;
    }

    default: {
      return snapshot;
    }
  }

  return upsertRecord(snapshot, event.sessionId, record);
}

export type { SessionRecord, SessionsSnapshot } from "@/state/session-types";
