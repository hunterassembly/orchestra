import { type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useTheme } from "@/theme/theme-provider";

export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export type ButtonProps = Omit<PressableProps, "style"> & {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

type ButtonVariantStyle = {
  container: ViewStyle;
  text: TextStyle;
};

type ButtonSizeStyle = {
  container: ViewStyle;
  text: TextStyle;
};

function createVariantStyles(theme: ReturnType<typeof useTheme>): Record<ButtonVariant, ButtonVariantStyle> {
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
    secondary: {
      container: {
        backgroundColor: theme.colors.navigator,
        borderColor: theme.colors.navigator,
      },
      text: {
        color: theme.colors.foreground,
      },
    },
    ghost: {
      container: {
        backgroundColor: theme.colors.background,
        borderColor: theme.colors.background,
        borderWidth: 0,
      },
      text: {
        color: theme.colors.foreground,
      },
    },
  };
}

function createSizeStyles(theme: ReturnType<typeof useTheme>): Record<ButtonSize, ButtonSizeStyle> {
  return {
    default: {
      container: {
        minHeight: 44,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
      },
      text: {
        fontSize: theme.typography.body.fontSize,
        lineHeight: theme.typography.body.lineHeight,
      },
    },
    sm: {
      container: {
        minHeight: 36,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
      },
      text: {
        fontSize: theme.typography.fontSize.sm,
        lineHeight: theme.typography.body.lineHeight,
      },
    },
    lg: {
      container: {
        minHeight: 48,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
      },
      text: {
        fontSize: theme.typography.fontSize.lg,
        lineHeight: theme.typography.heading.lineHeight,
      },
    },
    icon: {
      container: {
        height: 44,
        width: 44,
        paddingHorizontal: 0,
        paddingVertical: 0,
      },
      text: {
        fontSize: theme.typography.body.fontSize,
        lineHeight: theme.typography.body.lineHeight,
      },
    },
  };
}

export function Button({
  children,
  variant = "default",
  size = "default",
  style,
  textStyle,
  disabled,
  ...props
}: ButtonProps) {
  const theme = useTheme();
  const variantStyles = createVariantStyles(theme)[variant];
  const sizeStyles = createSizeStyles(theme)[size];

  const typographyStyle: TextStyle = {
    fontFamily: theme.typography.body.fontFamily,
    fontWeight: theme.typography.body.fontWeight,
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[
        styles.container,
        {
          borderRadius: theme.radius.md,
          borderWidth: 1,
        },
        sizeStyles.container,
        variantStyles.container,
        disabled ? styles.disabled : undefined,
        style,
      ]}
      {...props}
    >
      {typeof children === "string" || typeof children === "number" ?
        <Text style={[typographyStyle, sizeStyles.text, variantStyles.text, textStyle]}>{children}</Text>
      :
        children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
});
