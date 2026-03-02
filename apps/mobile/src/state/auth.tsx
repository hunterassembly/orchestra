import * as SecureStore from "expo-secure-store";
import {
  createElement,
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const AUTH_TOKEN_KEY = "orchestra.auth.token";

type AuthContextValue = {
  token: string | null;
  isHydrated: boolean;
  setToken: (token: string | null) => Promise<void>;
  clearToken: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren): ReactElement {
  const [token, setTokenState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydrate = async () => {
      try {
        const storedToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);

        if (isMounted) {
          setTokenState(storedToken);
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    void hydrate();

    return () => {
      isMounted = false;
    };
  }, []);

  const setToken = useCallback(async (nextToken: string | null) => {
    setTokenState(nextToken);

    if (nextToken) {
      await SecureStore.setItemAsync(AUTH_TOKEN_KEY, nextToken);
      return;
    }

    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
  }, []);

  const clearToken = useCallback(async () => {
    await setToken(null);
  }, [setToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      isHydrated,
      setToken,
      clearToken,
    }),
    [clearToken, isHydrated, setToken, token],
  );

  return createElement(AuthContext.Provider as never, { value }, children) as ReactElement;
}

export function useAuthState() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthState must be used within AuthProvider");
  }

  return context;
}
