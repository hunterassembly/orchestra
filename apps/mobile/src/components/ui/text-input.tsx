import { forwardRef } from "react";
import {
  StyleSheet,
  TextInput as RNTextInput,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from "react-native";

import { useTheme } from "@/theme/theme-provider";

export type ThemedTextInputProps = Omit<TextInputProps, "style"> & {
  invalid?: boolean;
  style?: StyleProp<TextStyle>;
};

export const TextInput = forwardRef<RNTextInput, ThemedTextInputProps>(function TextInput(
  { invalid = false, style, placeholderTextColor, ...props },
  ref,
) {
  const theme = useTheme();

  return (
    <RNTextInput
      placeholderTextColor={placeholderTextColor ?? theme.colors.info}
      ref={ref}
      selectionColor={theme.colors.accent}
      style={[
        styles.input,
        {
          backgroundColor: theme.colors.input,
          borderColor: invalid ? theme.colors.destructive : theme.colors.navigator,
          borderRadius: theme.radius.md,
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        },
        style,
      ]}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    minHeight: 44,
  },
});
