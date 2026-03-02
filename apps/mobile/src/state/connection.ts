import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { authStore } from "@/state/auth-store";

const DEFAULT_RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000] as const;
const DEFAULT_OFFLINE_TIMEOUT_MS = 60_000;
const DEFAULT_BACKGROUND_HOLD_MS = 30_000;

type TimerHandle = ReturnType<typeof setTimeout>;

type ConnectionTask = () => void | Promise<void>;

export type ConnectionStatus = "connected" | "reconnecting" | "offline";

export type ConnectionStoreConfig = {
  connectSse?: ConnectionTask;
  disconnectSse?: () => void;
  refreshAccessToken?: () => Promise<string | null>;
  triggerRePair?: () => Promise<void> | void;
  reconnectBackoffMs?: readonly number[];
  offlineTimeoutMs?: number;
  backgroundHoldMs?: number;
  now?: () => number;
  setTimeoutFn?: (handler: () => void, delayMs: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
};

export type ConnectionStoreState = {
  status: ConnectionStatus;
  reconnectAttempt: number;
  reconnectingSince: number | null;
  lastConnectedAt: number | null;
  nextRetryAt: number | null;
  isInBackground: boolean;
  markConnected: () => void;
  handleSseConnectionLoss: () => void;
  manualRetry: () => void;
  handleAuthFailure: (statusCode: number) => Promise<void>;
  handleTokenExpired: () => Promise<void>;
  handleAppBackground: () => void;
  handleAppForeground: () => void;
  reset: () => void;
};

export function createConnectionStore(config: ConnectionStoreConfig = {}) {
  const connectSse = config.connectSse ?? (() => undefined);
  const disconnectSse = config.disconnectSse ?? (() => undefined);
  const refreshAccessToken = config.refreshAccessToken ?? (async () => null);
  const triggerRePair = config.triggerRePair ?? (() => authStore.getState().triggerRePair());
  const reconnectBackoffMs =
    config.reconnectBackoffMs && config.reconnectBackoffMs.length > 0
      ? config.reconnectBackoffMs
      : DEFAULT_RECONNECT_BACKOFF_MS;
  const offlineTimeoutMs = config.offlineTimeoutMs ?? DEFAULT_OFFLINE_TIMEOUT_MS;
  const backgroundHoldMs = config.backgroundHoldMs ?? DEFAULT_BACKGROUND_HOLD_MS;
  const now = config.now ?? (() => Date.now());
  const setTimeoutFn = config.setTimeoutFn ?? ((handler: () => void, delayMs: number) => setTimeout(handler, delayMs));
  const clearTimeoutFn = config.clearTimeoutFn ?? ((handle: TimerHandle) => clearTimeout(handle));

  let retryTimer: TimerHandle | null = null;
  let offlineTimer: TimerHandle | null = null;
  let backgroundHoldTimer: TimerHandle | null = null;
  let droppedInBackground = false;

  return createStore<ConnectionStoreState>((set, get) => {
    const clearRetryTimer = () => {
      if (!retryTimer) {
        return;
      }

      clearTimeoutFn(retryTimer);
      retryTimer = null;
    };

    const clearOfflineTimer = () => {
      if (!offlineTimer) {
        return;
      }

      clearTimeoutFn(offlineTimer);
      offlineTimer = null;
    };

    const clearBackgroundHoldTimer = () => {
      if (!backgroundHoldTimer) {
        return;
      }

      clearTimeoutFn(backgroundHoldTimer);
      backgroundHoldTimer = null;
    };

    const clearAllTimers = () => {
      clearRetryTimer();
      clearOfflineTimer();
      clearBackgroundHoldTimer();
    };

    const setOffline = () => {
      clearRetryTimer();
      clearOfflineTimer();
      set((state) => ({
        ...state,
        status: "offline",
        reconnectingSince: null,
        nextRetryAt: null,
      }));
    };

    const scheduleOfflineTimeout = () => {
      clearOfflineTimer();

      if (offlineTimeoutMs <= 0) {
        return;
      }

      offlineTimer = setTimeoutFn(() => {
        offlineTimer = null;

        if (get().status !== "reconnecting") {
          return;
        }

        setOffline();
      }, offlineTimeoutMs);
    };

    const scheduleNextReconnect = () => {
      const state = get();
      if (state.status !== "reconnecting" || state.isInBackground || retryTimer) {
        return;
      }

      const delayMs =
        reconnectBackoffMs[Math.min(state.reconnectAttempt, reconnectBackoffMs.length - 1)] ??
        DEFAULT_RECONNECT_BACKOFF_MS.at(-1) ??
        30_000;

      set((current) => ({
        ...current,
        reconnectAttempt: current.reconnectAttempt + 1,
        nextRetryAt: now() + delayMs,
      }));

      retryTimer = setTimeoutFn(() => {
        retryTimer = null;
        set((current) => ({
          ...current,
          nextRetryAt: null,
        }));

        void (async () => {
          try {
            await connectSse();
          } catch {
            get().handleSseConnectionLoss();
          }
        })();
      }, delayMs);
    };

    const startReconnecting = (options: {
      immediate: boolean;
      resetReconnectWindow: boolean;
    }) => {
      const state = get();
      const shouldResetReconnectWindow =
        options.resetReconnectWindow || state.status !== "reconnecting" || state.reconnectingSince === null;
      const nextReconnectingSince = shouldResetReconnectWindow
        ? now()
        : (state.reconnectingSince ?? now());

      set((current) => ({
        ...current,
        status: "reconnecting",
        reconnectingSince: nextReconnectingSince,
      }));

      if (shouldResetReconnectWindow) {
        scheduleOfflineTimeout();
      }

      if (get().isInBackground) {
        return;
      }

      if (options.immediate) {
        set((current) => ({
          ...current,
          nextRetryAt: null,
        }));

        void (async () => {
          try {
            await connectSse();
          } catch {
            get().handleSseConnectionLoss();
          }
        })();
        return;
      }

      scheduleNextReconnect();
    };

    return {
      status: "connected",
      reconnectAttempt: 0,
      reconnectingSince: null,
      lastConnectedAt: null,
      nextRetryAt: null,
      isInBackground: false,

      markConnected: () => {
        droppedInBackground = false;
        clearRetryTimer();
        clearOfflineTimer();

        set((state) => ({
          ...state,
          status: "connected",
          reconnectAttempt: 0,
          reconnectingSince: null,
          lastConnectedAt: now(),
          nextRetryAt: null,
        }));
      },

      handleSseConnectionLoss: () => {
        const state = get();
        if (state.status === "offline") {
          return;
        }

        startReconnecting({
          immediate: false,
          resetReconnectWindow: false,
        });
      },

      manualRetry: () => {
        const state = get();
        if (state.status !== "offline") {
          return;
        }

        clearRetryTimer();
        clearOfflineTimer();

        set((current) => ({
          ...current,
          reconnectAttempt: 0,
          reconnectingSince: now(),
          nextRetryAt: null,
        }));

        startReconnecting({
          immediate: true,
          resetReconnectWindow: true,
        });
      },

      handleAuthFailure: async (statusCode: number) => {
        if (statusCode !== 401 && statusCode !== 403) {
          return;
        }

        clearAllTimers();
        disconnectSse();
        droppedInBackground = false;

        await triggerRePair();

        setOffline();
      },

      handleTokenExpired: async () => {
        try {
          const refreshedToken = await refreshAccessToken();
          if (refreshedToken) {
            clearRetryTimer();
            clearOfflineTimer();

            set((state) => ({
              ...state,
              reconnectAttempt: 0,
              reconnectingSince: now(),
              nextRetryAt: null,
            }));

            startReconnecting({
              immediate: true,
              resetReconnectWindow: true,
            });
            return;
          }
        } catch {
          // Fall through to re-pair flow.
        }

        await get().handleAuthFailure(401);
      },

      handleAppBackground: () => {
        if (get().isInBackground) {
          return;
        }

        set((state) => ({
          ...state,
          isInBackground: true,
        }));

        clearRetryTimer();
        clearOfflineTimer();
        clearBackgroundHoldTimer();

        backgroundHoldTimer = setTimeoutFn(() => {
          backgroundHoldTimer = null;

          if (!get().isInBackground) {
            return;
          }

          droppedInBackground = true;
          disconnectSse();

          if (get().status === "connected") {
            set((state) => ({
              ...state,
              status: "reconnecting",
              reconnectingSince: now(),
              nextRetryAt: null,
            }));
          }
        }, backgroundHoldMs);
      },

      handleAppForeground: () => {
        const state = get();
        if (!state.isInBackground) {
          return;
        }

        set((current) => ({
          ...current,
          isInBackground: false,
        }));

        clearBackgroundHoldTimer();

        if (droppedInBackground || get().status === "reconnecting") {
          droppedInBackground = false;
          clearRetryTimer();
          clearOfflineTimer();

          set((current) => ({
            ...current,
            reconnectAttempt: 0,
            reconnectingSince: now(),
            nextRetryAt: null,
          }));

          startReconnecting({
            immediate: true,
            resetReconnectWindow: true,
          });
        }
      },

      reset: () => {
        droppedInBackground = false;
        clearAllTimers();
        set({
          status: "connected",
          reconnectAttempt: 0,
          reconnectingSince: null,
          lastConnectedAt: null,
          nextRetryAt: null,
          isInBackground: false,
        });
      },
    };
  });
}

export const connectionStore = createConnectionStore();

export function useConnectionStore<T>(selector: (state: ConnectionStoreState) => T): T {
  return useStore(connectionStore, selector);
}
