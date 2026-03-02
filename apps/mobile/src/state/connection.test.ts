import { createConnectionStore } from "@/state/connection";

describe("connection state machine", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("transitions connected -> reconnecting on SSE loss and reconnecting -> connected on recovery", () => {
    const connectSse = jest.fn();
    const store = createConnectionStore({ connectSse });

    store.getState().markConnected();
    expect(store.getState().status).toBe("connected");

    store.getState().handleSseConnectionLoss();
    expect(store.getState().status).toBe("reconnecting");

    jest.advanceTimersByTime(999);
    expect(connectSse).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000 - 999);
    expect(connectSse).toHaveBeenCalledTimes(1);

    store.getState().markConnected();
    expect(store.getState().status).toBe("connected");
    expect(store.getState().reconnectAttempt).toBe(0);
  });

  it("transitions reconnecting -> offline after 60s and supports manual retry from offline", () => {
    const connectSse = jest.fn();
    const store = createConnectionStore({ connectSse, offlineTimeoutMs: 60_000 });

    store.getState().markConnected();
    store.getState().handleSseConnectionLoss();

    jest.advanceTimersByTime(60_000);
    expect(store.getState().status).toBe("offline");

    store.getState().manualRetry();
    expect(store.getState().status).toBe("reconnecting");
    expect(connectSse).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff 1s, 2s, 4s, 8s, then max 30s", () => {
    const connectSse = jest.fn(() => {
      throw new Error("sse down");
    });

    const store = createConnectionStore({
      connectSse,
      reconnectBackoffMs: [1_000, 2_000, 4_000, 8_000, 30_000],
      offlineTimeoutMs: 120_000,
    });

    store.getState().markConnected();
    store.getState().handleSseConnectionLoss();

    jest.advanceTimersByTime(1_000);
    expect(connectSse).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    expect(connectSse).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(4_000);
    expect(connectSse).toHaveBeenCalledTimes(3);

    jest.advanceTimersByTime(8_000);
    expect(connectSse).toHaveBeenCalledTimes(4);

    jest.advanceTimersByTime(30_000);
    expect(connectSse).toHaveBeenCalledTimes(5);

    jest.advanceTimersByTime(30_000);
    expect(connectSse).toHaveBeenCalledTimes(6);
  });

  it("enters offline after 60s of failed reconnecting without extending the timeout window", () => {
    const connectSse = jest.fn(() => {
      throw new Error("still down");
    });

    const store = createConnectionStore({
      connectSse,
      offlineTimeoutMs: 60_000,
    });

    store.getState().markConnected();
    store.getState().handleSseConnectionLoss();

    jest.advanceTimersByTime(60_000);

    expect(store.getState().status).toBe("offline");
    expect(connectSse).toHaveBeenCalledTimes(5);

    jest.advanceTimersByTime(30_000);
    expect(connectSse).toHaveBeenCalledTimes(5);
  });

  it("clears credentials via re-pair flow on auth failures (401/403)", async () => {
    const triggerRePair = jest.fn().mockResolvedValue(undefined);
    const store = createConnectionStore({ triggerRePair });

    store.getState().markConnected();
    await store.getState().handleAuthFailure(401);
    await store.getState().handleAuthFailure(403);

    expect(triggerRePair).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe("offline");
  });

  it("attempts token refresh first and only falls back to re-pair if refresh fails", async () => {
    const connectSse = jest.fn();
    const triggerRePair = jest.fn().mockResolvedValue(undefined);

    const refreshSuccessStore = createConnectionStore({
      connectSse,
      refreshAccessToken: jest.fn().mockResolvedValue("new-access-token"),
      triggerRePair,
    });

    await refreshSuccessStore.getState().handleTokenExpired();

    expect(connectSse).toHaveBeenCalledTimes(1);
    expect(refreshSuccessStore.getState().status).toBe("reconnecting");
    expect(triggerRePair).not.toHaveBeenCalled();

    const refreshFailureStore = createConnectionStore({
      connectSse: jest.fn(),
      refreshAccessToken: jest.fn().mockResolvedValue(null),
      triggerRePair,
    });

    await refreshFailureStore.getState().handleTokenExpired();

    expect(triggerRePair).toHaveBeenCalledTimes(1);
    expect(refreshFailureStore.getState().status).toBe("offline");
  });

  it("holds SSE for ~30s in background, then reconnects immediately on foreground", () => {
    const connectSse = jest.fn();
    const disconnectSse = jest.fn();

    const store = createConnectionStore({
      connectSse,
      disconnectSse,
      backgroundHoldMs: 30_000,
    });

    store.getState().markConnected();
    store.getState().handleAppBackground();

    jest.advanceTimersByTime(29_999);
    expect(disconnectSse).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(disconnectSse).toHaveBeenCalledTimes(1);

    store.getState().handleAppForeground();

    expect(connectSse).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe("reconnecting");
  });
});
