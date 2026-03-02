// @ts-nocheck
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { colors, radius } from "@craft-agent/mobile-tokens";
import { Appearance, StyleSheet } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectionChip } from "@/components/ui/connection-chip";
import { TextInput } from "@/components/ui/text-input";
import { ThemeProvider } from "@/theme/theme-provider";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

type ColorScheme = "light" | "dark" | null;

let mockColorScheme: ColorScheme = "light";

const mockedSecureStore = jest.mocked(SecureStore);

function flattenStyle(styleProp: unknown) {
  return StyleSheet.flatten(styleProp);
}

describe("mobile UI primitives", () => {
  beforeEach(() => {
    mockColorScheme = "light";
    mockedSecureStore.getItemAsync.mockReset();
    mockedSecureStore.setItemAsync.mockReset();
    mockedSecureStore.deleteItemAsync.mockReset();
    mockedSecureStore.getItemAsync.mockResolvedValue(null);

    jest.spyOn(Appearance, "getColorScheme").mockImplementation(() => mockColorScheme);
    jest
      .spyOn(Appearance, "addChangeListener")
      .mockImplementation(() => ({ remove: jest.fn() }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders button variants with token-backed colors and sharp corners", async () => {
    render(
      <ThemeProvider>
        <>
          <Button testID="button-default" variant="default">
            Default
          </Button>
          <Button testID="button-destructive" variant="destructive">
            Destructive
          </Button>
          <Button testID="button-outline" variant="outline">
            Outline
          </Button>
          <Button testID="button-secondary" variant="secondary">
            Secondary
          </Button>
          <Button testID="button-ghost" variant="ghost">
            Ghost
          </Button>
          <Button testID="button-icon" size="icon">
            I
          </Button>
        </>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("button-default")).toBeTruthy();
    });

    expect(flattenStyle(screen.getByTestId("button-default").props.style)).toMatchObject({
      backgroundColor: colors.light.accent,
      borderColor: colors.light.accent,
      borderRadius: radius.md,
    });

    expect(flattenStyle(screen.getByTestId("button-destructive").props.style)).toMatchObject({
      backgroundColor: colors.light.destructive,
      borderColor: colors.light.destructive,
      borderRadius: radius.md,
    });

    expect(flattenStyle(screen.getByTestId("button-outline").props.style)).toMatchObject({
      backgroundColor: colors.light.paper,
      borderColor: colors.light.foreground,
      borderRadius: radius.md,
    });

    expect(flattenStyle(screen.getByTestId("button-secondary").props.style)).toMatchObject({
      backgroundColor: colors.light.navigator,
      borderColor: colors.light.navigator,
      borderRadius: radius.md,
    });

    expect(flattenStyle(screen.getByTestId("button-ghost").props.style)).toMatchObject({
      backgroundColor: colors.light.background,
      borderColor: colors.light.background,
      borderRadius: radius.md,
    });

    expect(flattenStyle(screen.getByTestId("button-icon").props.style)).toMatchObject({
      height: 44,
      width: 44,
    });
  });

  it("renders text input with token styles", async () => {
    render(
      <ThemeProvider>
        <TextInput placeholder="Session name" testID="ui-input" value="" />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("ui-input")).toBeTruthy();
    });

    expect(flattenStyle(screen.getByTestId("ui-input").props.style)).toMatchObject({
      backgroundColor: colors.light.input,
      borderColor: colors.light.navigator,
      borderRadius: radius.md,
      color: colors.light.foreground,
    });
  });

  it("renders badge variants with token-backed colors", async () => {
    render(
      <ThemeProvider>
        <>
          <Badge testID="badge-default">Default</Badge>
          <Badge testID="badge-secondary" variant="secondary">
            Secondary
          </Badge>
          <Badge testID="badge-destructive" variant="destructive">
            Destructive
          </Badge>
          <Badge testID="badge-outline" variant="outline">
            Outline
          </Badge>
        </>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("badge-default")).toBeTruthy();
    });

    expect(flattenStyle(screen.getByTestId("badge-default").props.style)).toMatchObject({
      backgroundColor: colors.light.accent,
      borderColor: colors.light.accent,
      borderRadius: radius.sm,
    });

    expect(flattenStyle(screen.getByTestId("badge-secondary").props.style)).toMatchObject({
      backgroundColor: colors.light.navigator,
      borderColor: colors.light.navigator,
      borderRadius: radius.sm,
    });

    expect(flattenStyle(screen.getByTestId("badge-destructive").props.style)).toMatchObject({
      backgroundColor: colors.light.destructive,
      borderColor: colors.light.destructive,
      borderRadius: radius.sm,
    });

    expect(flattenStyle(screen.getByTestId("badge-outline").props.style)).toMatchObject({
      backgroundColor: colors.light.paper,
      borderColor: colors.light.foreground,
      borderRadius: radius.sm,
    });
  });

  it("renders connection chip with colored dot and label and handles press", async () => {
    const onPress = jest.fn();

    render(
      <ThemeProvider>
        <ConnectionChip
          label="Connected"
          onPress={onPress}
          testID="connection-chip"
          tone="connected"
        />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("connection-chip"));
    expect(onPress).toHaveBeenCalledTimes(1);

    expect(flattenStyle(screen.getByTestId("connection-chip-dot").props.style)).toMatchObject({
      backgroundColor: colors.light.success,
    });

    expect(flattenStyle(screen.getByTestId("connection-chip").props.style)).toMatchObject({
      borderRadius: radius.md,
    });
  });
});
