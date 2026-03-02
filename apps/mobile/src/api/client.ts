import type {
  AttachmentDTO,
  CreateSessionOptionsDTO,
  ErrorDTO,
  PairingConfirmResponse,
  PairingStartResponse,
  SendMessageOptionsDTO,
  SessionCommandDTO,
  SessionDTO,
  TokenRefreshResponse,
  WorkspaceDTO,
} from "@craft-agent/mobile-contracts";

type HealthResponse = {
  status: string;
  version: string;
};

type SessionDetailResponse = SessionDTO & {
  hasMore?: boolean;
  nextCursor?: string | null;
};

type StatusResponse = {
  status: string;
};

type RequestConfig = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  auth?: boolean;
};

type RequestState = {
  attemptedRefresh: boolean;
  tokenOverride?: string;
};

export type UploadAttachmentInput = {
  name: string;
  mimeType: string;
  data: string;
};

export type ApiClientAuthStore = {
  getAccessToken: () => string | null | Promise<string | null>;
  getRefreshToken: () => string | null | Promise<string | null>;
  setAccessToken: (token: string | null) => void | Promise<void>;
  triggerRePair: () => void | Promise<void>;
};

export type ApiClientConfig = {
  baseUrl: string;
  authStore: ApiClientAuthStore;
};

class ApiClient {
  private readonly baseUrl: string;

  private readonly authStore: ApiClientAuthStore;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authStore = config.authStore;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>({
      method: "GET",
      path: "/api/health",
    });
  }

  async getWorkspaces(): Promise<WorkspaceDTO[]> {
    return this.request<WorkspaceDTO[]>({
      method: "GET",
      path: "/api/workspaces",
      auth: true,
    });
  }

  async getSessions(workspaceId: string): Promise<SessionDTO[]> {
    return this.request<SessionDTO[]>({
      method: "GET",
      path: `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      auth: true,
    });
  }

  async createSession(workspaceId: string, options: CreateSessionOptionsDTO): Promise<SessionDTO> {
    return this.request<SessionDTO>({
      method: "POST",
      path: `/api/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
      auth: true,
      body: options,
    });
  }

  async getSession(sessionId: string): Promise<SessionDetailResponse> {
    return this.request<SessionDetailResponse>({
      method: "GET",
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      auth: true,
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<void>({
      method: "DELETE",
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      auth: true,
    });
  }

  async sendMessage(
    sessionId: string,
    message: string,
    options?: SendMessageOptionsDTO,
  ): Promise<StatusResponse> {
    return this.request<StatusResponse>({
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      auth: true,
      body: {
        message,
        ...(options ? { options } : {}),
      },
    });
  }

  async interrupt(sessionId: string): Promise<StatusResponse> {
    return this.request<StatusResponse>({
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      auth: true,
    });
  }

  async killShell(sessionId: string, shellId: string): Promise<StatusResponse> {
    return this.request<StatusResponse>({
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/shells/${encodeURIComponent(shellId)}/kill`,
      auth: true,
    });
  }

  async sendCommand(sessionId: string, command: SessionCommandDTO): Promise<StatusResponse> {
    return this.request<StatusResponse>({
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/commands`,
      auth: true,
      body: command,
    });
  }

  async uploadAttachment(sessionId: string, file: UploadAttachmentInput): Promise<AttachmentDTO> {
    return this.request<AttachmentDTO>({
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/attachments`,
      auth: true,
      body: file,
    });
  }

  async pairStart(): Promise<PairingStartResponse> {
    return this.request<PairingStartResponse>({
      method: "POST",
      path: "/api/pair/start",
    });
  }

  async pairConfirm(pairingId: string, code: string): Promise<PairingConfirmResponse> {
    return this.request<PairingConfirmResponse>({
      method: "POST",
      path: "/api/pair/confirm",
      body: { pairingId, code },
    });
  }

  async refreshToken(refreshToken: string): Promise<TokenRefreshResponse> {
    return this.request<TokenRefreshResponse>({
      method: "POST",
      path: "/api/pair/refresh",
      body: { refreshToken },
    });
  }

  private async request<T>(config: RequestConfig, state?: Partial<RequestState>): Promise<T> {
    const requestState: RequestState = {
      attemptedRefresh: state?.attemptedRefresh ?? false,
      tokenOverride: state?.tokenOverride,
    };

    const headers: Record<string, string> = {};

    if (config.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (config.auth) {
      const token = requestState.tokenOverride ?? (await this.authStore.getAccessToken());
      if (!token) {
        throw new Error("Authentication required. Please pair this device.");
      }

      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${config.path}`, {
        method: config.method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new Error(`Network request failed: ${message}`);
    }

    if (response.status === 401 && config.auth && !requestState.attemptedRefresh) {
      const refreshedToken = await this.tryRefreshToken();
      if (!refreshedToken) {
        await this.authStore.triggerRePair();
        throw new Error("Authentication expired. Please pair this device again.");
      }

      return this.request<T>(config, {
        attemptedRefresh: true,
        tokenOverride: refreshedToken,
      });
    }

    if (!response.ok) {
      throw await this.createHttpError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private async tryRefreshToken(): Promise<string | null> {
    const refreshToken = await this.authStore.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    try {
      const response = await this.refreshToken(refreshToken);
      await this.authStore.setAccessToken(response.accessToken);
      return response.accessToken;
    } catch {
      return null;
    }
  }

  private async createHttpError(response: Response): Promise<Error> {
    let errorCode = "unknown_error";
    let errorMessage = "Request failed";

    try {
      const payload = (await response.json()) as Partial<ErrorDTO> | null;
      if (payload?.code) {
        errorCode = payload.code;
      }

      if (payload?.message) {
        errorMessage = payload.message;
      }
    } catch {
      try {
        const text = await response.text();
        if (text) {
          errorMessage = text;
        }
      } catch {
        // Ignore text parse fallback errors
      }
    }

    return new Error(`API request failed (${response.status} ${errorCode}): ${errorMessage}`);
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}

export type MobileApiClient = ReturnType<typeof createApiClient>;
