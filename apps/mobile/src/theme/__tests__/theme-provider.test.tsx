// @ts-nocheck
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { useEffect } from "react";
import { Appearance, Pressable, Text, View } from "react-native";

import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from "@/theme/theme-provider";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

type ColorScheme = "light" | "dark" | null;

let mockColorScheme: ColorScheme = "light";
let mockAppearanceListener: ((payload: { colorScheme: ColorScheme }) => void) | null = null;

const mockedSecureStore = jest.mocked(SecureStore);

let mountCount = 0;
let unmountCount = 0;

function ThemeProbe() {
  const { isHydrated, preference, resolvedMode, setPreference } = useTheme();

  useEffect(() => {
    mountCount += 1;
    return () => {
      unmountCount += 1;
    };
  }, []);

  return (
    <View>
      <Text testID="theme-hydrated">{String(isHydrated)}</Text>
      <Text testID="theme-preference">{preference}</Text>
      <Text testID="theme-mode">{resolvedMode}</Text>

      <Pressable
        onPress={() => {
          void setPreference("light");
        }}
        testID="set-light"
      />

      <Pressable
        onPress={() => {
          void setPreference("dark");
        }}
        testID="set-dark"
      />

      <Pressable
        onPress={() => {
          void setPreference("system");
        }}
        testID="set-system"
      />
    </View>
  );
}

describe("theme provider", () => {
  beforeEach(() => {
    mountCount = 0;
    unmountCount = 0;
    mockColorScheme = "light";
    mockAppearanceListener = null;

    mockedSecureStore.getItemAsync.mockReset();
    mockedSecureStore.setItemAsync.mockReset();
    mockedSecureStore.deleteItemAsync.mockReset();

    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    jest.spyOn(Appearance, "getColorScheme").mockImplementation(() => mockColorScheme);
    jest.spyOn(Appearance, "addChangeListener").mockImplementation(
      (listener: (payload: { colorScheme: ColorScheme }) => void) => {
        mockAppearanceListener = listener;

        return {
          remove: () => {
            mockAppearanceListener = null;
          },
        } as never;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves system preference from Appearance color scheme", async () => {
    mockColorScheme = "dark";

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-hydrated").children.join("")).toBe("true");
    });

    expect(screen.getByTestId("theme-preference").children.join("")).toBe("system");
    expect(screen.getByTestId("theme-mode").children.join("")).toBe("dark");
  });

  it("uses persisted light/dark preference over system", async () => {
    mockColorScheme = "dark";
    mockedSecureStore.getItemAsync.mockResolvedValue("light");

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-mode").children.join("")).toBe("light");
    });

    expect(screen.getByTestId("theme-preference").children.join("")).toBe("light");
  });

  it("persists preference changes", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-hydrated").children.join("")).toBe("true");
    });

    fireEvent.press(screen.getByTestId("set-dark"));

    await waitFor(() => {
      expect(mockedSecureStore.setItemAsync).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
    });

    expect(screen.getByTestId("theme-mode").children.join("")).toBe("dark");
  });

  it("updates resolved mode when system preference receives Appearance changes", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-mode").children.join("")).toBe("light");
    });

    act(() => {
      mockAppearanceListener?.({ colorScheme: "dark" });
    });

    expect(screen.getByTestId("theme-mode").children.join("")).toBe("dark");

    fireEvent.press(screen.getByTestId("set-light"));
    act(() => {
      mockAppearanceListener?.({ colorScheme: "light" });
    });

    expect(screen.getByTestId("theme-mode").children.join("")).toBe("light");
  });

  it("switches theme without remounting children", async () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("theme-hydrated").children.join("")).toBe("true");
    });

    fireEvent.press(screen.getByTestId("set-dark"));

    await waitFor(() => {
      expect(screen.getByTestId("theme-mode").children.join("")).toBe("dark");
    });

    fireEvent.press(screen.getByTestId("set-light"));

    await waitFor(() => {
      expect(screen.getByTestId("theme-mode").children.join("")).toBe("light");
    });

    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    expect(Appearance.addChangeListener).toHaveBeenCalled();
  });
});
