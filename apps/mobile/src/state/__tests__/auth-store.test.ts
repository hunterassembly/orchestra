import * as SecureStore from "expo-secure-store";

import { AUTH_STORAGE_KEYS, createAuthStore } from "@/state/auth-store";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockedSecureStore = jest.mocked(SecureStore);

describe("auth store", () => {
  beforeEach(() => {
    mockedSecureStore.getItemAsync.mockReset();
    mockedSecureStore.setItemAsync.mockReset();
    mockedSecureStore.deleteItemAsync.mockReset();
  });

  it("hydrates tokens from secure storage", async () => {
    mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
      if (key === AUTH_STORAGE_KEYS.accessToken) {
        return "access-1";
      }
      if (key === AUTH_STORAGE_KEYS.refreshToken) {
        return "refresh-1";
      }
      if (key === AUTH_STORAGE_KEYS.expiresAt) {
        return "100";
      }
      if (key === AUTH_STORAGE_KEYS.deviceId) {
        return "device-1";
      }
      return null;
    });

    const store = createAuthStore();
    await store.getState().hydrate();

    expect(store.getState().accessToken).toBe("access-1");
    expect(store.getState().refreshToken).toBe("refresh-1");
    expect(store.getState().tokenExpiresAt).toBe(100);
    expect(store.getState().deviceId).toBe("device-1");
    expect(store.getState().isHydrated).toBe(true);
  });

  it("supports legacy token key fallback", async () => {
    mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
      if (key === AUTH_STORAGE_KEYS.legacyToken) {
        return "legacy-token";
      }
      return null;
    });

    const store = createAuthStore();
    await store.getState().hydrate();

    expect(store.getState().accessToken).toBe("legacy-token");
  });

  it("normalizes runtime host during hydrate and persists canonical value", async () => {
    mockedSecureStore.getItemAsync.mockImplementation(async (key: string) => {
      if (key === AUTH_STORAGE_KEYS.runtimeHost) {
        return "192.168.1.2:7842/api";
      }
      return null;
    });

    const store = createAuthStore();
    await store.getState().hydrate();

    expect(store.getState().runtimeHost).toBe("http://192.168.1.2:7842");
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      AUTH_STORAGE_KEYS.runtimeHost,
      "http://192.168.1.2:7842",
    );
  });

  it("persists setTokens and clears credentials", async () => {
    const store = createAuthStore();

    await store.getState().setTokens({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresAt: 200,
      deviceId: "device-2",
    });

    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      AUTH_STORAGE_KEYS.accessToken,
      "access-2",
    );
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      AUTH_STORAGE_KEYS.refreshToken,
      "refresh-2",
    );

    await store.getState().clearCredentials();

    expect(store.getState().accessToken).toBeNull();
    expect(store.getState().refreshToken).toBeNull();
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_STORAGE_KEYS.accessToken);
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_STORAGE_KEYS.refreshToken);
  });

  it("tracks pairing state updates", () => {
    const store = createAuthStore();

    store.getState().setPairingState({
      status: "confirming",
      pairingId: "pair-1",
      host: "192.168.1.2",
      expiresAt: 1_000,
      error: null,
    });

    expect(store.getState().pairing.status).toBe("confirming");
    expect(store.getState().pairing.pairingId).toBe("pair-1");

    store.getState().clearPairingState();
    expect(store.getState().pairing.status).toBe("idle");
    expect(store.getState().pairing.pairingId).toBeNull();
  });

  it("detects token expiry and refreshes access token", async () => {
    const store = createAuthStore();

    await store.getState().setTokens({
      accessToken: "access-3",
      refreshToken: "refresh-3",
      expiresAt: Date.now() - 1,
      deviceId: "device-3",
    });

    expect(store.getState().isAccessTokenExpired()).toBe(true);

    const refresher = jest.fn().mockResolvedValue({
      accessToken: "access-4",
      expiresAt: Date.now() + 10_000,
    });

    const nextAccessToken = await store.getState().refreshAccessToken(refresher);

    expect(nextAccessToken).toBe("access-4");
    expect(store.getState().accessToken).toBe("access-4");
    expect(store.getState().requiresRePair).toBe(false);
  });

  it("falls back to re-pair when refresh fails", async () => {
    const store = createAuthStore();

    await store.getState().setTokens({
      accessToken: "access-5",
      refreshToken: "refresh-5",
      expiresAt: Date.now() - 1,
      deviceId: "device-5",
    });

    const refresher = jest.fn().mockRejectedValue(new Error("invalid"));
    const refreshed = await store.getState().refreshAccessToken(refresher);

    expect(refreshed).toBeNull();
    expect(store.getState().requiresRePair).toBe(true);
    expect(store.getState().accessToken).toBeNull();
    expect(store.getState().refreshToken).toBeNull();
  });

  it("normalizes runtime host when setting runtime host", async () => {
    const store = createAuthStore();

    await store.getState().setRuntimeHost("192.168.1.3:7842/path");

    expect(store.getState().runtimeHost).toBe("http://192.168.1.3:7842");
    expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(
      AUTH_STORAGE_KEYS.runtimeHost,
      "http://192.168.1.3:7842",
    );
  });
});
