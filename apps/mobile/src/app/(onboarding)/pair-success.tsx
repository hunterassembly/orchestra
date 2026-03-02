import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui";
import { useAuthStore } from "@/state/auth-store";
import { useTheme } from "@/theme/theme-provider";

export default function PairSuccessScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pairingHost = useAuthStore((state) => state.pairing.host);
  const clearPairingState = useAuthStore((state) => state.clearPairingState);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: theme.colors.background,
          flex: 1,
        },
        container: {
          alignItems: "center",
          flex: 1,
          gap: theme.spacing.lg,
          justifyContent: "center",
          paddingHorizontal: theme.spacing.lg,
        },
        check: {
          alignItems: "center",
          backgroundColor: theme.colors.success,
          borderRadius: theme.radius.lg,
          height: 80,
          justifyContent: "center",
          width: 80,
        },
        checkText: {
          color: theme.colors.background,
          fontFamily: theme.typography.heading.fontFamily,
          fontSize: theme.typography.fontSize["2xl"],
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
          opacity: 0.8,
          textAlign: "center",
        },
      }),
    [theme],
  );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.check}>
          <Text style={styles.checkText}>✓</Text>
        </View>
        <Text style={styles.title}>Paired Successfully</Text>
        <Text style={styles.description}>
          Connected to {pairingHost ?? "your runtime"}.
        </Text>
        <Button
          onPress={() => {
            clearPairingState();
            router.replace("/(main)");
          }}
        >
          Open Sessions
        </Button>
      </View>
    </SafeAreaView>
  );
}
