import type {
  CredentialRequestDTO,
  MessageDTO,
  PermissionRequestDTO,
  SessionDTO,
  SessionEventDTO,
  TokenUsageDTO,
} from "@craft-agent/mobile-contracts";

import {
  createEmptySessionsSnapshot,
  processSessionEvent,
  type SessionRecord,
  type SessionsSnapshot,
} from "@/state/event-processor";

function createSession(overrides: Partial<SessionDTO> = {}): SessionDTO {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    name: "Session",
    lastMessageAt: 1,
    isProcessing: false,
    sessionStatus: null,
    hasUnread: false,
    permissionMode: "ask",
    labels: [],
    preview: null,
    messageCount: 0,
    tokenUsage: null,
    ...overrides,
  };
}

function createSnapshot(recordOverrides?: Partial<SessionRecord>): SessionsSnapshot {
  const baseRecord: SessionRecord = {
    session: createSession(),
    messages: [],
    permissionRequests: [],
    credentialRequests: [],
    streaming: null,
    sessionMetadata: { isFlagged: false },
  };

  const record: SessionRecord = {
    ...baseRecord,
    ...recordOverrides,
    sessionMetadata: recordOverrides?.sessionMetadata ?? baseRecord.sessionMetadata,
  };

  return {
    ...createEmptySessionsSnapshot("workspace-1"),
    sessionOrder: ["session-1"],
    sessionsById: {
      "session-1": record,
    },
  };
}

describe("event processor", () => {
  it("accumulates text_delta into a streaming assistant message", () => {
    const snapshot = createSnapshot();

    const once = processSessionEvent(snapshot, {
      type: "text_delta",
      sessionId: "session-1",
      delta: "Hello",
      turnId: "turn-1",
    });
    const twice = processSessionEvent(once, {
      type: "text_delta",
      sessionId: "session-1",
      delta: " world",
      turnId: "turn-1",
    });

    const record = twice.sessionsById["session-1"];
    expect(record?.messages).toHaveLength(1);
    expect(record?.messages[0]?.content).toBe("Hello world");
    expect(record?.messages[0]?.isStreaming).toBe(true);
  });

  it("finalizes text_complete and clears streaming state", () => {
    const withDelta = processSessionEvent(createSnapshot(), {
      type: "text_delta",
      sessionId: "session-1",
      delta: "partial",
      turnId: "turn-1",
    });

    const completed = processSessionEvent(withDelta, {
      type: "text_complete",
      sessionId: "session-1",
      text: "final",
      turnId: "turn-1",
      timestamp: 42,
    });

    const record = completed.sessionsById["session-1"];
    expect(record?.messages[0]?.content).toBe("final");
    expect(record?.messages[0]?.isStreaming).toBe(false);
    expect(record?.messages[0]?.isPending).toBe(false);
    expect(record?.streaming).toBeNull();
    expect(record?.messages[0]?.timestamp).toBe(42);
  });

  it("handles tool_start and tool_result for same toolUseId", () => {
    const withToolStart = processSessionEvent(createSnapshot(), {
      type: "tool_start",
      sessionId: "session-1",
      toolUseId: "tool-1",
      toolName: "Read",
      toolInput: { file: "a.ts" },
    });

    const withToolResult = processSessionEvent(withToolStart, {
      type: "tool_result",
      sessionId: "session-1",
      toolUseId: "tool-1",
      toolName: "Read",
      result: "ok",
    });

    const message = withToolResult.sessionsById["session-1"]?.messages[0];
    expect(message?.role).toBe("tool");
    expect(message?.toolStatus).toBe("completed");
    expect(message?.toolResult).toBe("ok");
  });

  it("marks tool_result as error when isError is true", () => {
    const withToolStart = processSessionEvent(createSnapshot(), {
      type: "tool_start",
      sessionId: "session-1",
      toolUseId: "tool-1",
      toolName: "Read",
      toolInput: { file: "a.ts" },
    });

    const updatedTool = processSessionEvent(withToolStart, {
      type: "tool_result",
      sessionId: "session-1",
      toolUseId: "tool-1",
      toolName: "Read",
      result: "failed",
      isError: true,
    });

    const pushedTool = processSessionEvent(createSnapshot(), {
      type: "tool_result",
      sessionId: "session-1",
      toolUseId: "tool-2",
      toolName: "Write",
      result: "failed",
      isError: true,
    });

    expect(updatedTool.sessionsById["session-1"]?.messages[0]?.toolStatus).toBe("error");
    expect(pushedTool.sessionsById["session-1"]?.messages[0]?.toolStatus).toBe("error");
  });

  it("appends status/info/error/typed_error timeline messages", () => {
    const typedError = {
      code: "boom",
      message: "Something failed",
      title: "Failure",
    };

    let next = createSnapshot();
    next = processSessionEvent(next, {
      type: "status",
      sessionId: "session-1",
      message: "Working",
    });
    next = processSessionEvent(next, {
      type: "info",
      sessionId: "session-1",
      message: "Still working",
      level: "info",
    });
    next = processSessionEvent(next, {
      type: "error",
      sessionId: "session-1",
      error: "plain error",
    });
    next = processSessionEvent(next, {
      type: "typed_error",
      sessionId: "session-1",
      error: typedError,
    });

    const messages = next.sessionsById["session-1"]?.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual(["status", "info", "error", "error"]);
    expect(messages[3]?.content).toContain("Failure");
  });

  it("queues permission_request and credential_request", () => {
    const permissionRequest: PermissionRequestDTO = {
      requestId: "perm-1",
      toolName: "Bash",
      description: "Run npm test",
    };
    const credentialRequest: CredentialRequestDTO = {
      requestId: "cred-1",
      sourceSlug: "github",
      description: "Need token",
    };

    const withPermission = processSessionEvent(createSnapshot(), {
      type: "permission_request",
      sessionId: "session-1",
      request: permissionRequest,
    });
    const withCredential = processSessionEvent(withPermission, {
      type: "credential_request",
      sessionId: "session-1",
      request: credentialRequest,
    });

    const record = withCredential.sessionsById["session-1"];
    expect(record?.permissionRequests).toEqual([permissionRequest]);
    expect(record?.credentialRequests).toEqual([credentialRequest]);
  });

  it("handles complete/interrupted/user_message/usage_update", () => {
    const optimisticMessage: MessageDTO = {
      id: "optimistic-1",
      role: "user",
      content: "Hello",
      timestamp: 100,
      toolName: null,
      toolUseId: null,
      toolInput: null,
      toolResult: null,
      toolStatus: null,
      isStreaming: false,
      isPending: true,
      isIntermediate: false,
    };

    const usage: TokenUsageDTO = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      contextTokens: 30,
      costUsd: 0,
    };

    let next = createSnapshot({
      session: createSession({ isProcessing: true }),
      messages: [optimisticMessage],
    });

    next = processSessionEvent(next, {
      type: "user_message",
      sessionId: "session-1",
      status: "accepted",
      optimisticMessageId: "optimistic-1",
      message: {
        ...optimisticMessage,
        id: "backend-1",
        isPending: false,
      },
    });

    next = processSessionEvent(next, {
      type: "usage_update",
      sessionId: "session-1",
      tokenUsage: { inputTokens: 33, contextWindow: 200 },
    });

    next = processSessionEvent(next, {
      type: "complete",
      sessionId: "session-1",
      hasUnread: true,
      tokenUsage: usage,
    });

    next = processSessionEvent(next, {
      type: "interrupted",
      sessionId: "session-1",
    });

    const record = next.sessionsById["session-1"];
    expect(record?.messages[0]?.id).toBe("backend-1");
    expect(record?.session.tokenUsage).toEqual(usage);
    expect(record?.session.hasUnread).toBe(true);
    expect(record?.session.isProcessing).toBe(false);
  });

  it("updates lifecycle metadata events", () => {
    let next = processSessionEvent(createEmptySessionsSnapshot("workspace-1"), {
      type: "session_created",
      sessionId: "session-2",
    });

    next = processSessionEvent(next, {
      type: "session_status_changed",
      sessionId: "session-2",
      sessionStatus: "running",
    });
    next = processSessionEvent(next, {
      type: "name_changed",
      sessionId: "session-2",
      name: "Renamed",
    });
    next = processSessionEvent(next, {
      type: "session_flagged",
      sessionId: "session-2",
    });
    next = processSessionEvent(next, {
      type: "session_unflagged",
      sessionId: "session-2",
    });
    next = processSessionEvent(next, {
      type: "permission_mode_changed",
      sessionId: "session-2",
      permissionMode: "allow-all",
    });

    const record = next.sessionsById["session-2"];
    expect(record?.session.name).toBe("Renamed");
    expect(record?.session.sessionStatus).toBe("running");
    expect(record?.session.permissionMode).toBe("allow-all");
    expect(record?.sessionMetadata.isFlagged).toBe(false);

    next = processSessionEvent(next, {
      type: "session_deleted",
      sessionId: "session-2",
    });
    expect(next.sessionsById["session-2"]).toBeUndefined();
  });

  it("covers every MVP event type in SESSION_EVENT_TYPES", () => {
    const events: SessionEventDTO[] = [
      { type: "text_delta", sessionId: "session-1", delta: "a" },
      { type: "text_complete", sessionId: "session-1", text: "b" },
      { type: "tool_start", sessionId: "session-1", toolName: "Read", toolUseId: "tool-1", toolInput: {} },
      { type: "tool_result", sessionId: "session-1", toolUseId: "tool-1", toolName: "Read", result: "ok" },
      { type: "status", sessionId: "session-1", message: "status" },
      { type: "info", sessionId: "session-1", message: "info" },
      { type: "error", sessionId: "session-1", error: "error" },
      { type: "typed_error", sessionId: "session-1", error: { code: "x", message: "y" } },
      { type: "complete", sessionId: "session-1" },
      { type: "interrupted", sessionId: "session-1" },
      { type: "shell_killed", sessionId: "session-1", shellId: "shell-1" },
      {
        type: "permission_request",
        sessionId: "session-1",
        request: { requestId: "perm-1", toolName: "Bash", description: "desc" },
      },
      { type: "credential_request", sessionId: "session-1", request: { requestId: "cred-1" } },
      {
        type: "user_message",
        sessionId: "session-1",
        status: "accepted",
        message: {
          id: "user-1",
          role: "user",
          content: "hello",
          timestamp: 1,
          toolName: null,
          toolUseId: null,
          toolInput: null,
          toolResult: null,
          toolStatus: null,
          isStreaming: false,
          isPending: false,
          isIntermediate: false,
        },
      },
      { type: "usage_update", sessionId: "session-1", tokenUsage: { inputTokens: 1 } },
      { type: "session_created", sessionId: "session-1" },
      { type: "session_deleted", sessionId: "session-1" },
      { type: "session_status_changed", sessionId: "session-1", sessionStatus: "idle" },
      { type: "name_changed", sessionId: "session-1", name: "name" },
      { type: "session_flagged", sessionId: "session-1" },
      { type: "session_unflagged", sessionId: "session-1" },
      { type: "permission_mode_changed", sessionId: "session-1", permissionMode: "ask" },
    ];

    let snapshot = createSnapshot();

    for (const event of events) {
      snapshot = processSessionEvent(snapshot, event);
    }

    expect(snapshot).toBeDefined();
  });
});
