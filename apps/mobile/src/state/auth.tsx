import {
  Fragment,
  createElement,
  type ReactNode,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useEffect,
} from "react";

import { useAuthStore } from "@/state/auth-store";

type AuthContextValue = {
  token: string | null;
  isHydrated: boolean;
  setToken: (token: string | null) => Promise<void>;
  clearToken: () => Promise<void>;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  isRefreshing: boolean;
  requiresRePair: boolean;
  pairing: ReturnType<typeof useAuthStoreState>["pairing"];
  refreshAccessToken: ReturnType<typeof useAuthStoreState>["refreshAccessToken"];
  triggerRePair: ReturnType<typeof useAuthStoreState>["triggerRePair"];
};

function AuthStoreProvider({ children }: { children: ReactNode }): ReactElement {
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return createElement(Fragment, null, children);
}

function useAuthStoreState() {
  return useAuthStore((state) => state);
}

export function AuthProvider({ children }: PropsWithChildren): ReactElement {
  return createElement(AuthStoreProvider as never, null, children) as ReactElement;
}

export function useAuthState(): AuthContextValue {
  const {
    accessToken,
    refreshToken,
    tokenExpiresAt,
    isHydrated,
    isRefreshing,
    requiresRePair,
    pairing,
    setAccessToken,
    clearCredentials,
    refreshAccessToken,
    triggerRePair,
  } = useAuthStoreState();

  const setToken = useCallback(
    async (nextToken: string | null) => {
      if (nextToken) {
        await setAccessToken(nextToken);
        return;
      }

      await clearCredentials();
    },
    [clearCredentials, setAccessToken],
  );

  const clearToken = useCallback(async () => {
    await clearCredentials();
  }, [clearCredentials]);

  return {
    token: accessToken,
    isHydrated,
    setToken,
    clearToken,
    refreshToken,
    tokenExpiresAt,
    isRefreshing,
    requiresRePair,
    pairing,
    refreshAccessToken,
    triggerRePair,
  };
}
