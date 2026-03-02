import { Stack } from "expo-router";
import { createElement } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuthState } from "@/state/auth";
import { ThemeProvider } from "@/theme/theme-provider";

function RootNavigator() {
  const { isHydrated, token } = useAuthState();

  if (!isHydrated) {
    return (
      <View style={styles.loadingContainer} testID="auth-loading">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {token ? (
        <Stack.Screen name="(main)" />
      ) : (
        <Stack.Screen name="(onboarding)" />
      )}
    </Stack>
  );
}

export default function RootLayout() {
  return createElement(
    SafeAreaProvider as never,
    null,
    createElement(
      ThemeProvider as never,
      null,
      createElement(
        AuthProvider as never,
        null,
        createElement(RootNavigator as never),
      ),
    ),
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
