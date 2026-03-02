import {
  colors,
  mobileTokens,
  type ColorMode,
  type SemanticColorTokens,
  type SurfaceColorTokens,
} from "@craft-agent/mobile-tokens";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { Appearance } from "react-native";

export const THEME_STORAGE_KEY = "orchestra.theme.preference";

export type ThemePreference = "light" | "dark" | "system";

export type ThemeContextValue = {
  isHydrated: boolean;
  preference: ThemePreference;
  resolvedMode: ColorMode;
  colors: (typeof colors)[ColorMode];
  semanticColors: SemanticColorTokens;
  surfaceColors: SurfaceColorTokens;
  spacing: typeof mobileTokens.spacing;
  radius: typeof mobileTokens.radius;
  typography: typeof mobileTokens.typography;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function normalizeColorMode(colorScheme: string | null | undefined): ColorMode {
  return colorScheme === "dark" ? "dark" : "light";
}

function resolveMode(preference: ThemePreference, systemMode: ColorMode): ColorMode {
  if (preference === "system") {
    return systemMode;
  }

  return preference;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [systemMode, setSystemMode] = useState<ColorMode>(() =>
    normalizeColorMode(Appearance.getColorScheme()),
  );
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const hydratePreference = async () => {
      try {
        const storedPreference = await SecureStore.getItemAsync(THEME_STORAGE_KEY);

        if (isMounted && isThemePreference(storedPreference)) {
          setPreferenceState(storedPreference);
        }
      } finally {
        if (isMounted) {
          setIsHydrated(true);
        }
      }
    };

    void hydratePreference();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemMode(normalizeColorMode(colorScheme));
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const setPreference = useCallback(async (nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    await SecureStore.setItemAsync(THEME_STORAGE_KEY, nextPreference);
  }, []);

  const resolvedMode = useMemo(() => resolveMode(preference, systemMode), [preference, systemMode]);

  const themeValue = useMemo<ThemeContextValue>(() => {
    return {
      isHydrated,
      preference,
      resolvedMode,
      colors: colors[resolvedMode],
      semanticColors: mobileTokens.semanticColors[resolvedMode],
      surfaceColors: mobileTokens.surfaceColors[resolvedMode],
      spacing: mobileTokens.spacing,
      radius: mobileTokens.radius,
      typography: mobileTokens.typography,
      setPreference,
    };
  }, [isHydrated, preference, resolvedMode, setPreference]);

  return createElement(ThemeContext.Provider as never, { value: themeValue }, children as never);
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}
