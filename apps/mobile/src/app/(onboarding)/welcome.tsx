import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui";
import { useTheme } from "@/theme/theme-provider";

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: theme.colors.background,
          flex: 1,
        },
        container: {
          flex: 1,
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing["2xl"],
        },
        body: {
          alignItems: "center",
          gap: theme.spacing.lg,
          marginTop: theme.spacing["2xl"],
        },
        logo: {
          alignItems: "center",
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.foreground,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          height: 96,
          justifyContent: "center",
          width: 96,
        },
        logoText: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.heading.fontFamily,
          fontSize: theme.typography.fontSize.lg,
          fontWeight: theme.typography.heading.fontWeight,
          lineHeight: theme.typography.heading.lineHeight,
        },
        title: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.heading.fontFamily,
          fontSize: theme.typography.heading.fontSize,
          fontWeight: theme.typography.heading.fontWeight,
          lineHeight: theme.typography.heading.lineHeight,
          textAlign: "center",
        },
        description: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          maxWidth: 320,
          opacity: 0.8,
          textAlign: "center",
        },
        actions: {
          gap: theme.spacing.sm,
        },
      }),
    [theme],
  );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.body}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>Orchestra</Text>
          </View>

          <Text style={styles.title}>Orchestra for iPhone</Text>
          <Text style={styles.description}>
            Connect to your Mac runtime and continue the same Orchestra sessions from anywhere.
          </Text>
        </View>

        <View style={styles.actions}>
          <Button onPress={() => router.push("/(onboarding)/find-runtime")}>Pair Device</Button>
          <Button onPress={() => router.push("/(onboarding)/find-runtime")} variant="ghost">
            How It Works
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
