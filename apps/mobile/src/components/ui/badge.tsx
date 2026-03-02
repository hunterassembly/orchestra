import { type PropsWithChildren } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/theme/theme-provider";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

type BadgeProps = PropsWithChildren<
  Omit<ViewProps, "style"> & {
    variant?: BadgeVariant;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
  }
>;

type BadgeVariantStyle = {
  container: ViewStyle;
  text: TextStyle;
};

function createVariantStyles(theme: ReturnType<typeof useTheme>): Record<BadgeVariant, BadgeVariantStyle> {
  return {
    default: {
      container: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      text: {
        color: theme.colors.background,
      },
    },
    secondary: {
      container: {
        backgroundColor: theme.colors.navigator,
        borderColor: theme.colors.navigator,
      },
      text: {
        color: theme.colors.foreground,
      },
    },
    destructive: {
      container: {
        backgroundColor: theme.colors.destructive,
        borderColor: theme.colors.destructive,
      },
      text: {
        color: theme.colors.background,
      },
    },
    outline: {
      container: {
        backgroundColor: theme.colors.paper,
        borderColor: theme.colors.foreground,
      },
      text: {
        color: theme.colors.foreground,
      },
    },
  };
}

export function Badge({ children, variant = "default", style, textStyle, ...props }: BadgeProps) {
  const theme = useTheme();
  const variantStyles = createVariantStyles(theme)[variant];

  return (
    <View
      style={[
        styles.container,
        {
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
        variantStyles.container,
        style,
      ]}
      {...props}
    >
      <Text
        style={[
          {
            fontFamily: theme.typography.body.fontFamily,
            fontSize: theme.typography.fontSize.xs,
            fontWeight: theme.typography.body.fontWeight,
            lineHeight: theme.typography.body.lineHeight,
          },
          variantStyles.text,
          textStyle,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
});
