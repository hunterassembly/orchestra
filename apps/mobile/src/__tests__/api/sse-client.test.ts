import type { SessionEventDTO } from "@craft-agent/mobile-contracts";

import { createInMemorySseCursorStore, createSseClient, type EventSourceLike } from "@/api/sse-client";

type MockEvent = {
  type?: string;
  data?: string;
  lastEventId?: string;
  id?: string;
};

class MockEventSource implements EventSourceLike {
  readonly close = jest.fn(() => {
    this.closed = true;
  });

  private readonly listeners = new Map<string, Set<(event: MockEvent) => void>>();

  closed = false;

  constructor(
    readonly url: string,
    readonly init: {
      headers?: Record<string, string>;
    },
  ) {}

  addEventListener(type: string, listener: (event: MockEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MockEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: MockEvent = {}): void {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }

    const payload: MockEvent = {
      type,
      ...event,
    };

    for (const listener of listeners) {
      listener(payload);
    }
  }
}

function createEventSourceFactory() {
  const instances: MockEventSource[] = [];
  const factory = jest.fn((url: string, init: { headers?: Record<string, string> }) => {
    const instance = new MockEventSource(url, init);
    instances.push(instance);
    return instance;
  });

  return { factory, instances };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("sse client", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("connects to workspace SSE endpoint with bearer auth", async () => {
    const { factory } = createEventSourceFactory();

    const client = createSseClient({
      baseUrl: "http://localhost:7842/",
      authStore: {
        getAccessToken: jest.fn().mockResolvedValue("access-token"),
      },
      eventSourceFactory: factory,
    });

    await client.connect("workspace one");

    expect(factory).toHaveBeenCalledWith(
      "http://localhost:7842/api/workspaces/workspace%20one/events",
      {
        headers: {
          Authorization: "Bearer access-token",
        },
      },
    );

    client.disconnect();
  });

  it("parses SSE payloads into SessionEventDTO and emits onEvent", async () => {
    const onEvent = jest.fn();
    const { factory, instances } = createEventSourceFactory();

    const client = createSseClient({
      baseUrl: "http://localhost:7842",
      authStore: {
        getAccessToken: jest.fn().mockResolvedValue("access-token"),
      },
      onEvent,
      eventSourceFactory: factory,
    });

    await client.connect("workspace-1");

    instances[0]?.emit("text_delta", {
      data: JSON.stringify({
        type: "text_delta",
        sessionId: "session-1",
        delta: "hello",
      } satisfies SessionEventDTO),
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: "text_delta",
      sessionId: "session-1",
      delta: "hello",
    });

    client.disconnect();
  });

  it("stores and reuses per-workspace cursor for reconnect resume", async () => {
    const { factory, instances } = createEventSourceFactory();
    const cursorStore = createInMemorySseCursorStore();

    const client = createSseClient({
      baseUrl: "http://localhost:7842",
      authStore: {
        getAccessToken: jest.fn().mockResolvedValue("access-token"),
      },
      cursorStore,
      eventSourceFactory: factory,
    });

    await client.connect("workspace-1");

    instances[0]?.emit("text_delta", {
      lastEventId: "cursor-123",
      data: JSON.stringify({
        type: "text_delta",
        sessionId: "session-1",
        delta: "hello",
      } satisfies SessionEventDTO),
    });

    client.disconnect();
    await client.connect("workspace-1");

    expect(factory).toHaveBeenNthCalledWith(
      2,
      "http://localhost:7842/api/workspaces/workspace-1/events",
      {
        headers: {
          Authorization: "Bearer access-token",
          "Last-Event-ID": "cursor-123",
        },
      },
    );

    client.disconnect();
  });

  it("treats heartbeat ping as liveness-only and does not emit onEvent", async () => {
    jest.useFakeTimers();

    const onEvent = jest.fn();
    const onHeartbeat = jest.fn();
    const onReconnectScheduled = jest.fn();
    const { factory, instances } = createEventSourceFactory();

    const client = createSseClient({
      baseUrl: "http://localhost:7842",
      authStore: {
        getAccessToken: jest.fn().mockResolvedValue("access-token"),
      },
      livenessTimeoutMs: 1_000,
      reconnectBackoffMs: [10],
      onEvent,
      onHeartbeat,
      onReconnectScheduled,
      eventSourceFactory: factory,
    });

    await client.connect("workspace-1");

    instances[0]?.emit("open");
    jest.advanceTimersByTime(900);
    instances[0]?.emit("ping", { data: JSON.stringify({ type: "ping" }) });

    jest.advanceTimersByTime(900);
    expect(onReconnectScheduled).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onHeartbeat).toHaveBeenCalledWith("workspace-1");

    jest.advanceTimersByTime(200);
    expect(onReconnectScheduled).toHaveBeenCalledWith("workspace-1", 1, 10);

    client.disconnect();
  });

  it("keeps only one active stream by closing prior connection on reconnect or workspace switch", async () => {
    const { factory, instances } = createEventSourceFactory();

    const client = createSseClient({
      baseUrl: "http://localhost:7842",
      authStore: {
        getAccessToken: jest.fn().mockResolvedValue("access-token"),
      },
      eventSourceFactory: factory,
    });

    await client.connect("workspace-1");
    const firstConnection = instances[0];

    await client.connect("workspace-1");
    expect(firstConnection?.close).toHaveBeenCalledTimes(1);

    const secondConnection = instances[1];
    await client.connect("workspace-2");
    expect(secondConnection?.close).toHaveBeenCalledTimes(1);

    client.disconnect();
  });

  it("auto-reconnects using configured backoff delays", async () => {
    jest.useFakeTimers();

    const onReconnectScheduled = jest.fn();
    const { factory, instances } = createEventSourceFactory();

    const client = createSseClient({
      baseUrl: "http://localhost:7842",
      authStore: {
        getAccessToken: jest.fn().mockResolvedValue("access-token"),
      },
      livenessTimeoutMs: 0,
      reconnectBackoffMs: [5, 10],
      onReconnectScheduled,
      eventSourceFactory: factory,
    });

    await client.connect("workspace-1");
    const firstConnection = instances[0];

    firstConnection?.emit("error", { data: "disconnect" });
    expect(onReconnectScheduled).toHaveBeenNthCalledWith(1, "workspace-1", 1, 5);

    jest.advanceTimersByTime(5);
    await flushMicrotasks();
    expect(factory).toHaveBeenCalledTimes(2);

    const secondConnection = instances[1];
    secondConnection?.emit("error", { data: "disconnect" });
    expect(onReconnectScheduled).toHaveBeenNthCalledWith(2, "workspace-1", 2, 10);

    jest.advanceTimersByTime(10);
    await flushMicrotasks();
    expect(factory).toHaveBeenCalledTimes(3);

    client.disconnect();
  });
});
