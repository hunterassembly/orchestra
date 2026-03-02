import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createRuntimeApiClient } from "@/api/runtime-client";
import { Button, TextInput } from "@/components/ui";
import { useAuthStore } from "@/state/auth-store";
import { useTheme } from "@/theme/theme-provider";

function normalizeHost(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unable to connect to runtime. Check the host and try again.";
}

export default function FindRuntimeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pairing = useAuthStore((state) => state.pairing);
  const setPairingState = useAuthStore((state) => state.setPairingState);
  const clearPairingState = useAuthStore((state) => state.clearPairingState);
  const setRuntimeHost = useAuthStore((state) => state.setRuntimeHost);
  const [hostInput, setHostInput] = useState(pairing.host ?? "127.0.0.1:7842");
  const [isConnecting, setIsConnecting] = useState(false);
  const ThemedTextInput = TextInput as unknown as any;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: theme.colors.background,
          flex: 1,
        },
        container: {
          flex: 1,
          gap: theme.spacing.lg,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xl,
        },
        title: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.heading.fontFamily,
          fontSize: theme.typography.heading.fontSize,
          fontWeight: theme.typography.heading.fontWeight,
          lineHeight: theme.typography.heading.lineHeight,
        },
        description: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          opacity: 0.8,
        },
        card: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.foreground,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          gap: theme.spacing.xs,
          padding: theme.spacing.md,
        },
        cardTitle: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: "700",
          lineHeight: theme.typography.body.lineHeight,
        },
        cardSubtitle: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          opacity: 0.75,
        },
        fieldLabel: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: "700",
          lineHeight: theme.typography.body.lineHeight,
        },
        error: {
          color: theme.colors.destructive,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
        },
      }),
    [theme],
  );

  const connect = async () => {
    if (isConnecting) {
      return;
    }

    const host = normalizeHost(hostInput);
    if (!host) {
      setPairingState({
        status: "error",
        error: "Enter a runtime hostname or IP address.",
      });
      return;
    }

    setIsConnecting(true);
    await setRuntimeHost(host);
    setPairingState({
      status: "starting",
      host,
      error: null,
      pairingId: null,
      expiresAt: null,
    });

    try {
      const client = createRuntimeApiClient(host);
      await client.health();
      const pairingStart = await client.pairStart();

      setPairingState({
        status: "confirming",
        host,
        pairingId: pairingStart.pairingId,
        expiresAt: pairingStart.expiresAt,
        error: null,
      });

      router.push("/(onboarding)/confirm-pair");
    } catch (error) {
      setPairingState({
        status: "error",
        error: toUserMessage(error),
      });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Connect Runtime</Text>
        <Text style={styles.description}>
          Enter your Orchestra runtime host. This must be reachable from your iPhone.
        </Text>

        {pairing.host ?
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Last Runtime</Text>
            <Text style={styles.cardSubtitle}>{pairing.host}</Text>
          </View>
        : null}

        <Text style={styles.fieldLabel}>Hostname or IP</Text>
        <ThemedTextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isConnecting}
          keyboardType="url"
          onChangeText={setHostInput}
          placeholder="192.168.1.42:7842"
          value={hostInput}
        />

        {pairing.error ?
          <Text style={styles.error}>{pairing.error}</Text>
        : null}

        <Button disabled={isConnecting} onPress={() => void connect()}>
          {isConnecting ?
            <ActivityIndicator color={theme.colors.background} />
          : "Connect"}
        </Button>
        <Button
          onPress={clearPairingState}
          variant="ghost"
        >
          Reset Pairing State
        </Button>
      </View>
    </SafeAreaView>
  );
}
