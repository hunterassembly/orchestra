import type { TokenRefreshResponse } from "@craft-agent/mobile-contracts";
import * as SecureStore from "expo-secure-store";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export const AUTH_STORAGE_KEYS = {
  accessToken: "orchestra.auth.accessToken",
  refreshToken: "orchestra.auth.refreshToken",
  expiresAt: "orchestra.auth.expiresAt",
  deviceId: "orchestra.auth.deviceId",
  legacyToken: "orchestra.auth.token",
} as const;

export type PairingState = {
  status: "idle" | "starting" | "confirming" | "paired" | "error";
  pairingId: string | null;
  host: string | null;
  expiresAt: number | null;
  error: string | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  deviceId: string;
};

export type AuthStoreState = {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  deviceId: string | null;
  isHydrated: boolean;
  isRefreshing: boolean;
  requiresRePair: boolean;
  pairing: PairingState;
  hydrate: () => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  setAccessToken: (token: string | null, expiresAt?: number | null) => Promise<void>;
  setRefreshToken: (token: string | null) => Promise<void>;
  clearCredentials: () => Promise<void>;
  setPairingState: (next: Partial<PairingState>) => void;
  clearPairingState: () => void;
  isAccessTokenExpired: (now?: number) => boolean;
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  refreshAccessToken: (
    refresher: (refreshToken: string) => Promise<TokenRefreshResponse>,
  ) => Promise<string | null>;
  triggerRePair: () => Promise<void>;
};

const INITIAL_PAIRING_STATE: PairingState = {
  status: "idle",
  pairingId: null,
  host: null,
  expiresAt: null,
  error: null,
};

function parseExpiresAt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function persistString(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await SecureStore.deleteItemAsync(key);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export function createAuthStore() {
  return createStore<AuthStoreState>((set, get) => ({
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    deviceId: null,
    isHydrated: false,
    isRefreshing: false,
    requiresRePair: false,
    pairing: INITIAL_PAIRING_STATE,

    hydrate: async () => {
      const [accessToken, refreshToken, expiresAt, deviceId, legacyToken] = await Promise.all([
        SecureStore.getItemAsync(AUTH_STORAGE_KEYS.accessToken),
        SecureStore.getItemAsync(AUTH_STORAGE_KEYS.refreshToken),
        SecureStore.getItemAsync(AUTH_STORAGE_KEYS.expiresAt),
        SecureStore.getItemAsync(AUTH_STORAGE_KEYS.deviceId),
        SecureStore.getItemAsync(AUTH_STORAGE_KEYS.legacyToken),
      ]);

      set({
        accessToken: accessToken ?? legacyToken,
        refreshToken,
        tokenExpiresAt: parseExpiresAt(expiresAt),
        deviceId,
        isHydrated: true,
      });
    },

    setTokens: async (tokens) => {
      set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        deviceId: tokens.deviceId,
        requiresRePair: false,
      });

      await Promise.all([
        persistString(AUTH_STORAGE_KEYS.accessToken, tokens.accessToken),
        persistString(AUTH_STORAGE_KEYS.refreshToken, tokens.refreshToken),
        persistString(AUTH_STORAGE_KEYS.expiresAt, String(tokens.expiresAt)),
        persistString(AUTH_STORAGE_KEYS.deviceId, tokens.deviceId),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.legacyToken),
      ]);
    },

    setAccessToken: async (token, expiresAt) => {
      set((state) => ({
        accessToken: token,
        tokenExpiresAt: expiresAt ?? state.tokenExpiresAt,
      }));

      await Promise.all([
        persistString(AUTH_STORAGE_KEYS.accessToken, token),
        expiresAt !== undefined
          ? persistString(
              AUTH_STORAGE_KEYS.expiresAt,
              expiresAt === null ? null : String(expiresAt),
            )
          : Promise.resolve(),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.legacyToken),
      ]);
    },

    setRefreshToken: async (token) => {
      set({ refreshToken: token });
      await persistString(AUTH_STORAGE_KEYS.refreshToken, token);
    },

    clearCredentials: async () => {
      set({
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        deviceId: null,
      });

      await Promise.all([
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.accessToken),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.refreshToken),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.expiresAt),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.deviceId),
        SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.legacyToken),
      ]);
    },

    setPairingState: (next) => {
      set((state) => ({
        pairing: {
          ...state.pairing,
          ...next,
        },
      }));
    },

    clearPairingState: () => {
      set({ pairing: INITIAL_PAIRING_STATE });
    },

    isAccessTokenExpired: (now = Date.now()) => {
      const state = get();
      if (!state.accessToken) {
        return true;
      }

      if (!state.tokenExpiresAt) {
        return false;
      }

      return state.tokenExpiresAt <= now;
    },

    getAccessToken: () => {
      return get().accessToken;
    },

    getRefreshToken: () => {
      return get().refreshToken;
    },

    refreshAccessToken: async (refresher) => {
      const refreshToken = get().refreshToken;
      if (!refreshToken) {
        await get().triggerRePair();
        return null;
      }

      set({ isRefreshing: true });

      try {
        const response = await refresher(refreshToken);
        await get().setAccessToken(response.accessToken, response.expiresAt);
        set({
          isRefreshing: false,
          requiresRePair: false,
        });
        return response.accessToken;
      } catch {
        set({ isRefreshing: false });
        await get().triggerRePair();
        return null;
      }
    },

    triggerRePair: async () => {
      await get().clearCredentials();
      set({
        requiresRePair: true,
        pairing: {
          ...INITIAL_PAIRING_STATE,
          status: "idle",
        },
      });
    },
  }));
}

export const authStore = createAuthStore();

export function useAuthStore<T>(selector: (state: AuthStoreState) => T): T {
  return useStore(authStore, selector);
}
