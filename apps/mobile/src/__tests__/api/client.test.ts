import type {
  AttachmentDTO,
  CreateSessionOptionsDTO,
  PairingConfirmResponse,
  PairingStartResponse,
  SessionCommandDTO,
  SessionDTO,
  TokenRefreshResponse,
  WorkspaceDTO,
} from "@craft-agent/mobile-contracts";

import { createApiClient, type ApiClientAuthStore, type UploadAttachmentInput } from "@/api/client";

type MockFetchResponseOptions = {
  status?: number;
  body?: unknown;
};

function mockFetchResponse(options: MockFetchResponseOptions = {}): Response {
  const status = options.status ?? 200;
  const body = options.body;

  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(
      typeof body === "string" ? body : body ? JSON.stringify(body) : "",
    ),
  } as unknown as Response;
}

describe("api client", () => {
  const baseUrl = "http://localhost:7842";

  let mockFetch: jest.Mock;
  let authStore: ApiClientAuthStore;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    authStore = {
      getAccessToken: jest.fn().mockResolvedValue("access-token"),
      getRefreshToken: jest.fn().mockResolvedValue("refresh-token"),
      setAccessToken: jest.fn().mockResolvedValue(undefined),
      triggerRePair: jest.fn().mockResolvedValue(undefined),
    };
  });

  it("health() requests GET /api/health without auth", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        body: { status: "ok", version: "1.0.0" },
      }),
    );

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.health();

    expect(response).toEqual({ status: "ok", version: "1.0.0" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/health",
      expect.objectContaining({ method: "GET" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeUndefined();
  });

  it("pairStart() requests POST /api/pair/start", async () => {
    const expected: PairingStartResponse = {
      pairingId: "pair-1",
      code: "123456",
      expiresAt: Date.now() + 300000,
    };
    mockFetch.mockResolvedValue(mockFetchResponse({ body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.pairStart();

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/pair/start",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("pairConfirm() requests POST /api/pair/confirm with JSON body", async () => {
    const expected: PairingConfirmResponse = {
      accessToken: "new-token",
      refreshToken: "new-refresh",
      expiresAt: Date.now() + 300000,
      deviceId: "device-1",
    };
    mockFetch.mockResolvedValue(mockFetchResponse({ body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.pairConfirm("pair-1", "123456");

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/pair/confirm",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json" }),
    );
    expect(JSON.parse(init.body as string)).toEqual({ pairingId: "pair-1", code: "123456" });
  });

  it("refreshToken() requests POST /api/pair/refresh with JSON body", async () => {
    const expected: TokenRefreshResponse = {
      accessToken: "refreshed-access",
      expiresAt: Date.now() + 300000,
    };
    mockFetch.mockResolvedValue(mockFetchResponse({ body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.refreshToken("refresh-123");

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/pair/refresh",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json" }),
    );
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: "refresh-123" });
  });

  it("authenticated methods include Authorization Bearer token", async () => {
    const workspaces: WorkspaceDTO[] = [{ id: "default", name: "Default" }];
    mockFetch.mockResolvedValue(mockFetchResponse({ body: workspaces }));

    const client = createApiClient({ baseUrl, authStore });
    await client.getWorkspaces();

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-token" }),
    );
  });

  it("getWorkspaces() calls GET /api/workspaces", async () => {
    const expected: WorkspaceDTO[] = [{ id: "default", name: "Default Workspace" }];
    mockFetch.mockResolvedValue(mockFetchResponse({ body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.getWorkspaces();

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/workspaces",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("getSessions(workspaceId) calls GET /api/workspaces/:workspaceId/sessions", async () => {
    const expected: SessionDTO[] = [];
    mockFetch.mockResolvedValue(mockFetchResponse({ body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.getSessions("workspace-1");

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/workspaces/workspace-1/sessions",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("createSession(workspaceId, options) calls POST /api/workspaces/:workspaceId/sessions with JSON body", async () => {
    const createOptions: CreateSessionOptionsDTO = {
      name: "New Session",
      permissionMode: "ask",
      workingDirectory: "user_default",
    };
    const expected: SessionDTO = {
      id: "session-1",
      workspaceId: "workspace-1",
      name: "New Session",
      workingDirectory: "user_default",
      lastMessageAt: Date.now(),
      isProcessing: false,
      sessionStatus: null,
      hasUnread: false,
      permissionMode: "ask",
      labels: [],
      preview: null,
      messageCount: 0,
      tokenUsage: null,
    };

    mockFetch.mockResolvedValue(mockFetchResponse({ status: 201, body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.createSession("workspace-1", createOptions);

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/workspaces/workspace-1/sessions",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      }),
    );
    expect(JSON.parse(init.body as string)).toEqual(createOptions);
  });

  it("getSession(sessionId) calls GET /api/sessions/:sessionId", async () => {
    const expected: SessionDTO & { hasMore: boolean; nextCursor?: string | null } = {
      id: "session-1",
      workspaceId: "workspace-1",
      name: "Session",
      lastMessageAt: Date.now(),
      isProcessing: false,
      sessionStatus: null,
      hasUnread: false,
      permissionMode: "ask",
      labels: [],
      preview: null,
      messageCount: 0,
      tokenUsage: null,
      messages: [],
      hasMore: false,
      nextCursor: null,
    };
    mockFetch.mockResolvedValue(mockFetchResponse({ body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.getSession("session-1");

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("deleteSession(sessionId) calls DELETE /api/sessions/:sessionId", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ status: 204 }));

    const client = createApiClient({ baseUrl, authStore });
    await client.deleteSession("session-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sendMessage(sessionId, message, options) calls POST /api/sessions/:sessionId/messages with JSON body", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "accepted" } }));

    const client = createApiClient({ baseUrl, authStore });
    await client.sendMessage("session-1", "Hello", {
      optimisticMessageId: "optimistic-1",
      ultrathinkEnabled: true,
      skillSlugs: ["foo", "bar"],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/messages",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      }),
    );
    expect(JSON.parse(init.body as string)).toEqual({
      message: "Hello",
      options: {
        optimisticMessageId: "optimistic-1",
        ultrathinkEnabled: true,
        skillSlugs: ["foo", "bar"],
      },
    });
  });

  it("sendMessage(sessionId, message, options, attachments) includes attachment references", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "accepted" } }));

    const client = createApiClient({ baseUrl, authStore });
    await client.sendMessage(
      "session-1",
      "Hello with file",
      { optimisticMessageId: "optimistic-2" },
      [{ id: "att-1" }],
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      message: "Hello with file",
      options: {
        optimisticMessageId: "optimistic-2",
      },
      attachments: [{ id: "att-1" }],
    });
  });

  it("interrupt(sessionId) calls POST /api/sessions/:sessionId/interrupt", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "ok" } }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.interrupt("session-1");

    expect(response).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/interrupt",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("killShell(sessionId, shellId) calls POST /api/sessions/:sessionId/shells/:shellId/kill", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "ok" } }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.killShell("session-1", "shell-9");

    expect(response).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/shells/shell-9/kill",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sendCommand(sessionId, command) calls POST /api/sessions/:sessionId/commands", async () => {
    const command: SessionCommandDTO = { type: "rename", name: "Updated" };
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "ok" } }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.sendCommand("session-1", command);

    expect(response).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/commands",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(command);
  });

  it("uploadAttachment(sessionId, file) calls POST /api/sessions/:sessionId/attachments", async () => {
    const file: UploadAttachmentInput = {
      name: "doc.txt",
      mimeType: "text/plain",
      data: "aGVsbG8=",
    };
    const expected: AttachmentDTO = {
      id: "att-1",
      name: "doc.txt",
      mimeType: "text/plain",
      size: 5,
    };
    mockFetch.mockResolvedValue(mockFetchResponse({ status: 201, body: expected }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.uploadAttachment("session-1", file);

    expect(response).toEqual(expected);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/attachments",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(file);
  });

  it("respondToPermission(sessionId, requestId, response) calls POST /api/sessions/:sessionId/permissions/:requestId", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "ok" } }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.respondToPermission("session-1", "perm-1", {
      allowed: true,
      alwaysAllow: true,
      options: { rememberForMinutes: 15 },
    });

    expect(response).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/permissions/perm-1",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      allowed: true,
      alwaysAllow: true,
      options: { rememberForMinutes: 15 },
    });
  });

  it("respondToCredential(sessionId, requestId, response) calls POST /api/sessions/:sessionId/credentials/:requestId", async () => {
    mockFetch.mockResolvedValue(mockFetchResponse({ body: { status: "ok" } }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.respondToCredential("session-1", "cred-1", {
      type: "credential",
      value: "secret-token",
      cancelled: false,
    });

    expect(response).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/sessions/session-1/credentials/cred-1",
      expect.objectContaining({ method: "POST" }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      type: "credential",
      value: "secret-token",
      cancelled: false,
    });
  });

  it("on 401, authenticated requests refresh token then retry once", async () => {
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse({ status: 401, body: { code: "token_expired" } }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 200,
          body: {
            accessToken: "refreshed-token",
            expiresAt: Date.now() + 300000,
          } satisfies TokenRefreshResponse,
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, body: [] }));

    const client = createApiClient({ baseUrl, authStore });
    const response = await client.getWorkspaces();

    expect(response).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const firstCall = mockFetch.mock.calls[0] as [string, RequestInit];
    const refreshCall = mockFetch.mock.calls[1] as [string, RequestInit];
    const retryCall = mockFetch.mock.calls[2] as [string, RequestInit];

    expect(firstCall[0]).toBe("http://localhost:7842/api/workspaces");
    expect(firstCall[1].headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer access-token" }),
    );

    expect(refreshCall[0]).toBe("http://localhost:7842/api/pair/refresh");
    expect(refreshCall[1].method).toBe("POST");
    expect(refreshCall[1].headers).toEqual(
      expect.objectContaining({ "Content-Type": "application/json" }),
    );

    expect(retryCall[0]).toBe("http://localhost:7842/api/workspaces");
    expect(retryCall[1].headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer refreshed-token" }),
    );

    expect(authStore.setAccessToken as jest.Mock).toHaveBeenCalledWith("refreshed-token");
    expect(authStore.triggerRePair as jest.Mock).not.toHaveBeenCalled();
  });

  it("when refresh fails after 401, triggers re-pair flow and throws readable error", async () => {
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse({ status: 401, body: { code: "token_expired" } }))
      .mockResolvedValueOnce(
        mockFetchResponse({
          status: 401,
          body: { code: "invalid_refresh_token", message: "Refresh token is invalid" },
        }),
      );

    const client = createApiClient({ baseUrl, authStore });

    await expect(client.getWorkspaces()).rejects.toThrow("Authentication expired. Please pair this device again.");
    expect(authStore.triggerRePair as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it("throws readable network error message when fetch rejects", async () => {
    mockFetch.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const client = createApiClient({ baseUrl, authStore });
    await expect(client.health()).rejects.toThrow("Network request failed: connect ECONNREFUSED");
  });

  it("throws readable HTTP error message from error DTO", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        status: 400,
        body: { code: "invalid_request", message: "Invalid create session options" },
      }),
    );

    const client = createApiClient({ baseUrl, authStore });

    await expect(client.createSession("workspace-1", {})).rejects.toThrow(
      "API request failed (400 invalid_request): Invalid create session options",
    );
  });

  it("normalizes legacy base URLs before issuing requests", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({
        body: { status: "ok", version: "1.0.0" },
      }),
    );

    const client = createApiClient({ baseUrl: "localhost:7842/api", authStore });
    await client.health();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:7842/api/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("on 403 for authenticated requests, triggers re-pair and throws readable error", async () => {
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse({
        status: 403,
        body: { code: "forbidden", message: "Token revoked" },
      }),
    );

    const client = createApiClient({ baseUrl, authStore });

    await expect(client.getWorkspaces()).rejects.toThrow(
      "Authentication expired. Please pair this device again.",
    );
    expect(authStore.triggerRePair as jest.Mock).toHaveBeenCalledTimes(1);
  });
});
