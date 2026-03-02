import { createApiClient, type MobileApiClient } from "@/api/client";
import { authStore } from "@/state/auth-store";

export function createRuntimeApiClient(baseUrl: string): MobileApiClient {
  return createApiClient({
    baseUrl,
    authStore: {
      getAccessToken: () => authStore.getState().getAccessToken(),
      getRefreshToken: () => authStore.getState().getRefreshToken(),
      setAccessToken: (token) => authStore.getState().setAccessToken(token),
      triggerRePair: () => authStore.getState().triggerRePair(),
    },
  });
}
