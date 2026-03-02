import type { MessageDTO, PermissionRequestDTO, SessionDTO } from "@craft-agent/mobile-contracts";

import { createSessionsStore } from "@/state/sessions";

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

function createMessage(overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: "message-1",
    role: "assistant",
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
    ...overrides,
  };
}

describe("sessions store", () => {
  it("supports session CRUD and active workspace state", () => {
    const store = createSessionsStore();

    store.getState().setActiveWorkspaceId("workspace-1");
    store.getState().setSessions([
      createSession({ id: "session-1" }),
      createSession({ id: "session-2", name: "Two" }),
    ]);

    expect(store.getState().activeWorkspaceId).toBe("workspace-1");
    expect(store.getState().sessionOrder).toEqual(["session-1", "session-2"]);
    expect(store.getState().getSessionById("session-2")?.session.name).toBe("Two");

    store.getState().upsertSession(createSession({ id: "session-2", name: "Updated" }));
    expect(store.getState().getSessionById("session-2")?.session.name).toBe("Updated");

    store.getState().deleteSession("session-1");
    expect(store.getState().sessionOrder).toEqual(["session-2"]);
  });

  it("supports session detail and message management", () => {
    const store = createSessionsStore();

    store.getState().upsertSession(createSession({ id: "session-1" }));
    store.getState().setSessionDetail("session-1", {
      ...createSession({ id: "session-1" }),
      messages: [createMessage({ id: "seed" })],
    });

    store.getState().appendMessage("session-1", createMessage({ id: "message-2" }));
    store.getState().updateMessage("session-1", "message-2", { content: "updated" });
    store.getState().removeMessage("session-1", "seed");

    const messages = store.getState().getSessionById("session-1")?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("message-2");
    expect(messages[0]?.content).toBe("updated");
  });

  it("supports permission and credential queue management", () => {
    const store = createSessionsStore();
    store.getState().upsertSession(createSession({ id: "session-1" }));

    const permissionRequest: PermissionRequestDTO = {
      requestId: "perm-1",
      toolName: "Bash",
      description: "Run",
    };

    store.getState().enqueuePermissionRequest("session-1", permissionRequest);
    store.getState().enqueueCredentialRequest("session-1", { requestId: "cred-1" });

    let record = store.getState().getSessionById("session-1");
    expect(record?.permissionRequests).toEqual([permissionRequest]);
    expect(record?.credentialRequests).toEqual([{ requestId: "cred-1" }]);

    store.getState().dequeuePermissionRequest("session-1", "perm-1");
    store.getState().dequeueCredentialRequest("session-1", "cred-1");

    record = store.getState().getSessionById("session-1");
    expect(record?.permissionRequests).toEqual([]);
    expect(record?.credentialRequests).toEqual([]);
  });

  it("applies event-processor updates for streaming and lifecycle events", () => {
    const store = createSessionsStore();
    store.getState().upsertSession(createSession({ id: "session-1" }));

    store.getState().applyEvent({
      type: "text_delta",
      sessionId: "session-1",
      delta: "Hello",
      turnId: "turn-1",
    });
    store.getState().applyEvent({
      type: "text_complete",
      sessionId: "session-1",
      text: "Hello world",
      turnId: "turn-1",
    });

    const record = store.getState().getSessionById("session-1");
    expect(record?.messages[0]?.content).toBe("Hello world");
    expect(record?.messages[0]?.isStreaming).toBe(false);

    store.getState().applyEvent({ type: "session_deleted", sessionId: "session-1" });
    expect(store.getState().getSessionById("session-1")).toBeUndefined();
  });

  it("resets all state", () => {
    const store = createSessionsStore();
    store.getState().setActiveWorkspaceId("workspace-1");
    store.getState().upsertSession(createSession());

    store.getState().reset();

    expect(store.getState().activeWorkspaceId).toBeNull();
    expect(store.getState().sessionOrder).toEqual([]);
    expect(store.getState().sessionsById).toEqual({});
  });
});
