import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/theme/theme-provider";

export type ConnectionTone = "connected" | "reconnecting" | "offline" | "idle";

export type ConnectionChipProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  tone?: ConnectionTone;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

function toneColor(tone: ConnectionTone, theme: ReturnType<typeof useTheme>): string {
  switch (tone) {
    case "connected":
      return theme.colors.success;
    case "reconnecting":
      return theme.colors.info;
    case "offline":
      return theme.colors.destructive;
    case "idle":
      return theme.colors.accent;
    default:
      return theme.colors.accent;
  }
}

export function ConnectionChip({
  label,
  tone = "idle",
  style,
  labelStyle,
  testID,
  ...props
}: ConnectionChipProps) {
  const theme = useTheme();
  const dotTestID = testID ? `${testID}-dot` : "connection-chip-dot";

  return (
    <Pressable
      accessibilityRole="button"
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.foreground,
          borderRadius: theme.radius.md,
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
        style,
      ]}
      testID={testID}
      {...props}
    >
      <View
        style={[
          styles.dot,
          {
            backgroundColor: toneColor(tone, theme),
            borderRadius: theme.spacing.xs,
            height: theme.spacing.sm,
            width: theme.spacing.sm,
          },
        ]}
        testID={dotTestID}
      />

      <Text
        style={[
          {
            color: theme.colors.foreground,
            fontFamily: theme.typography.body.fontFamily,
            fontSize: theme.typography.fontSize.sm,
            fontWeight: theme.typography.body.fontWeight,
            lineHeight: theme.typography.body.lineHeight,
          },
          labelStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 36,
  },
  dot: {},
});
