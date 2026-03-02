import { SESSION_EVENT_TYPES, type SessionEventDTO } from "@craft-agent/mobile-contracts";
import EventSource from "react-native-sse";

const DEFAULT_RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000] as const;
const DEFAULT_LIVENESS_TIMEOUT_MS = 45_000;

const sessionEventTypeSet = new Set<string>(SESSION_EVENT_TYPES);

type UnknownRecord = Record<string, unknown>;

export type SseAuthStore = {
  getAccessToken: () => string | null | Promise<string | null>;
};

export type SseCursorStore = {
  getCursor: (workspaceId: string) => string | null | Promise<string | null>;
  setCursor: (workspaceId: string, cursor: string) => void | Promise<void>;
};

export type SseRawEvent = {
  type?: string;
  data?: string;
  lastEventId?: string;
  id?: string;
  [key: string]: unknown;
};

export type EventSourceLike = {
  addEventListener: (type: string, listener: (event: SseRawEvent) => void) => void;
  close: () => void;
};

export type EventSourceFactory = (
  url: string,
  init: {
    headers?: Record<string, string>;
  },
) => EventSourceLike;

export type SseClientConfig = {
  baseUrl: string;
  authStore: SseAuthStore;
  cursorStore?: SseCursorStore;
  eventSourceFactory?: EventSourceFactory;
  reconnectBackoffMs?: readonly number[];
  livenessTimeoutMs?: number;
  onOpen?: (workspaceId: string) => void;
  onEvent?: (event: SessionEventDTO) => void;
  onHeartbeat?: (workspaceId: string) => void;
  onError?: (error: Error) => void;
  onReconnectScheduled?: (workspaceId: string, attempt: number, delayMs: number) => void;
};

type ActiveConnection = {
  workspaceId: string;
  stream: EventSourceLike;
  generation: number;
};

class InMemorySseCursorStore implements SseCursorStore {
  private readonly cursors = new Map<string, string>();

  getCursor(workspaceId: string): string | null {
    return this.cursors.get(workspaceId) ?? null;
  }

  setCursor(workspaceId: string, cursor: string): void {
    this.cursors.set(workspaceId, cursor);
  }
}

class SseClient {
  private readonly baseUrl: string;

  private readonly authStore: SseAuthStore;

  private readonly cursorStore: SseCursorStore;

  private readonly eventSourceFactory: EventSourceFactory;

  private readonly reconnectBackoffMs: readonly number[];

  private readonly livenessTimeoutMs: number;

  private readonly onOpen?: (workspaceId: string) => void;

  private readonly onEvent?: (event: SessionEventDTO) => void;

  private readonly onHeartbeat?: (workspaceId: string) => void;

  private readonly onError?: (error: Error) => void;

  private readonly onReconnectScheduled?: (workspaceId: string, attempt: number, delayMs: number) => void;

  private generation = 0;

  private activeWorkspaceId: string | null = null;

  private activeConnection: ActiveConnection | null = null;

  private reconnectAttempt = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private livenessTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SseClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.authStore = config.authStore;
    this.cursorStore = config.cursorStore ?? createInMemorySseCursorStore();
    this.eventSourceFactory = config.eventSourceFactory ?? createDefaultEventSourceFactory();
    this.reconnectBackoffMs =
      config.reconnectBackoffMs && config.reconnectBackoffMs.length > 0
        ? config.reconnectBackoffMs
        : DEFAULT_RECONNECT_BACKOFF_MS;
    this.livenessTimeoutMs = config.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
    this.onOpen = config.onOpen;
    this.onEvent = config.onEvent;
    this.onHeartbeat = config.onHeartbeat;
    this.onError = config.onError;
    this.onReconnectScheduled = config.onReconnectScheduled;
  }

  async connect(workspaceId: string): Promise<void> {
    this.generation += 1;
    const currentGeneration = this.generation;

    this.activeWorkspaceId = workspaceId;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.clearLivenessTimer();
    this.closeActiveConnection();

    await this.openConnection(workspaceId, currentGeneration);
  }

  disconnect(): void {
    this.generation += 1;
    this.activeWorkspaceId = null;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.clearLivenessTimer();
    this.closeActiveConnection();
  }

  getActiveWorkspaceId(): string | null {
    return this.activeWorkspaceId;
  }

  private async openConnection(workspaceId: string, generation: number): Promise<void> {
    if (!this.isCurrent(generation, workspaceId)) {
      return;
    }

    try {
      const accessToken = await this.authStore.getAccessToken();
      if (!accessToken) {
        this.handleConnectionFailure(
          workspaceId,
          generation,
          new Error("Authentication required for SSE connection."),
        );
        return;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
      };

      const cursor = await this.cursorStore.getCursor(workspaceId);
      if (cursor) {
        headers["Last-Event-ID"] = cursor;
      }

      if (!this.isCurrent(generation, workspaceId)) {
        return;
      }

      const stream = this.eventSourceFactory(this.getWorkspaceEventsUrl(workspaceId), { headers });

      this.activeConnection = {
        workspaceId,
        stream,
        generation,
      };

      this.attachStreamListeners(stream, workspaceId, generation);
    } catch (error) {
      this.handleConnectionFailure(workspaceId, generation, toError(error));
    }
  }

  private attachStreamListeners(stream: EventSourceLike, workspaceId: string, generation: number): void {
    const onOpen = () => {
      if (!this.isActiveConnection(stream, workspaceId, generation)) {
        return;
      }

      this.reconnectAttempt = 0;
      this.resetLivenessTimer(workspaceId, generation);
      this.onOpen?.(workspaceId);
    };

    const onError = (rawEvent: SseRawEvent) => {
      if (!this.isActiveConnection(stream, workspaceId, generation)) {
        return;
      }

      const details =
        typeof rawEvent.data === "string" && rawEvent.data.length > 0
          ? `: ${rawEvent.data}`
          : "";

      this.handleConnectionFailure(workspaceId, generation, new Error(`SSE connection error${details}`));
    };

    const onMessage = (rawEvent: SseRawEvent) => {
      if (!this.isActiveConnection(stream, workspaceId, generation)) {
        return;
      }

      this.resetLivenessTimer(workspaceId, generation);

      const payload = parseSsePayload(rawEvent, this.onError);
      if (!payload) {
        return;
      }

      if (isHeartbeatPayload(rawEvent, payload)) {
        this.onHeartbeat?.(workspaceId);
        return;
      }

      if (!isSessionEvent(payload)) {
        return;
      }

      const cursor = extractCursor(rawEvent);
      if (cursor) {
        void this.cursorStore.setCursor(workspaceId, cursor);
      }

      this.onEvent?.(payload);
    };

    stream.addEventListener("open", onOpen);
    stream.addEventListener("error", onError);
    stream.addEventListener("message", onMessage);
    stream.addEventListener("ping", onMessage);

    for (const eventType of SESSION_EVENT_TYPES) {
      stream.addEventListener(eventType, onMessage);
    }
  }

  private getWorkspaceEventsUrl(workspaceId: string): string {
    return `${this.baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/events`;
  }

  private isCurrent(generation: number, workspaceId: string): boolean {
    return this.generation === generation && this.activeWorkspaceId === workspaceId;
  }

  private isActiveConnection(
    stream: EventSourceLike,
    workspaceId: string,
    generation: number,
  ): boolean {
    return (
      this.activeConnection?.stream === stream &&
      this.activeConnection.workspaceId === workspaceId &&
      this.activeConnection.generation === generation &&
      this.isCurrent(generation, workspaceId)
    );
  }

  private handleConnectionFailure(workspaceId: string, generation: number, error: Error): void {
    if (!this.isCurrent(generation, workspaceId)) {
      return;
    }

    this.onError?.(error);
    this.clearLivenessTimer();
    this.closeActiveConnection();
    this.scheduleReconnect(workspaceId, generation);
  }

  private scheduleReconnect(workspaceId: string, generation: number): void {
    if (!this.isCurrent(generation, workspaceId) || this.reconnectTimer) {
      return;
    }

    const attempt = this.reconnectAttempt + 1;
    const backoffIndex = Math.max(0, Math.min(this.reconnectAttempt, this.reconnectBackoffMs.length - 1));
    const delayMs = this.reconnectBackoffMs[backoffIndex] ?? DEFAULT_RECONNECT_BACKOFF_MS.at(-1) ?? 30_000;

    this.reconnectAttempt = attempt;
    this.onReconnectScheduled?.(workspaceId, attempt, delayMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      if (!this.isCurrent(generation, workspaceId)) {
        return;
      }

      void this.openConnection(workspaceId, generation);
    }, delayMs);
  }

  private resetLivenessTimer(workspaceId: string, generation: number): void {
    this.clearLivenessTimer();

    if (this.livenessTimeoutMs <= 0) {
      return;
    }

    this.livenessTimer = setTimeout(() => {
      if (!this.isCurrent(generation, workspaceId)) {
        return;
      }

      this.handleConnectionFailure(workspaceId, generation, new Error("SSE liveness timeout."));
    }, this.livenessTimeoutMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearLivenessTimer(): void {
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private closeActiveConnection(): void {
    if (!this.activeConnection) {
      return;
    }

    this.activeConnection.stream.close();
    this.activeConnection = null;
  }
}

function createDefaultEventSourceFactory(): EventSourceFactory {
  return (url, init) => {
    const EventSourceConstructor = EventSource as unknown as new (
      inputUrl: string,
      options: { headers?: Record<string, string> },
    ) => EventSourceLike;

    return new EventSourceConstructor(url, {
      headers: init.headers,
    });
  };
}

function parseSsePayload(
  rawEvent: SseRawEvent,
  onError?: (error: Error) => void,
): unknown {
  if (typeof rawEvent.data !== "string") {
    if (rawEvent.type === "ping") {
      return { type: "ping" };
    }

    return null;
  }

  const data = rawEvent.data.trim();
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch {
    onError?.(new Error(`Failed to parse SSE payload: ${data}`));
    return null;
  }
}

function isHeartbeatPayload(rawEvent: SseRawEvent, payload: unknown): boolean {
  if (rawEvent.type === "ping") {
    return true;
  }

  if (!isObject(payload)) {
    return false;
  }

  return payload.type === "ping";
}

function isSessionEvent(payload: unknown): payload is SessionEventDTO {
  if (!isObject(payload)) {
    return false;
  }

  const type = payload.type;
  const sessionId = payload.sessionId;

  return typeof type === "string" && sessionEventTypeSet.has(type) && typeof sessionId === "string";
}

function extractCursor(rawEvent: SseRawEvent): string | null {
  if (typeof rawEvent.lastEventId === "string" && rawEvent.lastEventId.length > 0) {
    return rawEvent.lastEventId;
  }

  if (typeof rawEvent.id === "string" && rawEvent.id.length > 0) {
    return rawEvent.id;
  }

  return null;
}

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown SSE client error");
}

export function createInMemorySseCursorStore(): SseCursorStore {
  return new InMemorySseCursorStore();
}

export function createSseClient(config: SseClientConfig) {
  return new SseClient(config);
}

export type MobileSseClient = ReturnType<typeof createSseClient>;
