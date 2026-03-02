import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, type TextInput as RNTextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createRuntimeApiClient } from "@/api/runtime-client";
import { Button, TextInput } from "@/components/ui";
import { useAuthStore } from "@/state/auth-store";
import { useTheme } from "@/theme/theme-provider";

const CODE_LENGTH = 6;

function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Pairing failed. Please try again.";
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function ConfirmPairScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pairing = useAuthStore((state) => state.pairing);
  const setPairingState = useAuthStore((state) => state.setPairingState);
  const setTokens = useAuthStore((state) => state.setTokens);
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() =>
    pairing.expiresAt ? Math.max(0, pairing.expiresAt - Date.now()) : 0,
  );
  const inputRefs = useRef<Array<RNTextInput | null>>([]);
  const ThemedTextInput = TextInput as unknown as any;

  useEffect(() => {
    if (!pairing.host || !pairing.pairingId) {
      router.replace("/(onboarding)/find-runtime");
      return;
    }

    if (!pairing.expiresAt) {
      return;
    }

    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, pairing.expiresAt! - Date.now()));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [pairing.expiresAt, pairing.host, pairing.pairingId, router]);

  useEffect(() => {
    if (pairing.expiresAt && remainingMs === 0) {
      setPairingState({
        status: "error",
        error: "Pairing code expired. Start a new pairing session.",
      });
    }
  }, [pairing.expiresAt, remainingMs, setPairingState]);

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
        subtitle: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          opacity: 0.8,
        },
        runtime: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
        },
        codeRow: {
          flexDirection: "row",
          gap: theme.spacing.xs,
          justifyContent: "space-between",
        },
        codeInput: {
          flex: 1,
          fontSize: theme.typography.fontSize.xl,
          textAlign: "center",
        },
        countdown: {
          color: theme.colors.info,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.body.fontWeight,
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

  const code = digits.join("");
  const canSubmit = code.length === CODE_LENGTH && remainingMs > 0 && !isSubmitting;

  const submitCode = async (explicitCode?: string) => {
    const value = explicitCode ?? code;
    if (!pairing.host || !pairing.pairingId || value.length !== CODE_LENGTH || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setPairingState({
      status: "confirming",
      error: null,
    });

    try {
      const client = createRuntimeApiClient(pairing.host);
      const confirmation = await client.pairConfirm(pairing.pairingId, value);
      await setTokens({
        accessToken: confirmation.accessToken,
        refreshToken: confirmation.refreshToken,
        expiresAt: confirmation.expiresAt,
        deviceId: confirmation.deviceId,
      });

      setPairingState({
        status: "paired",
        error: null,
      });
      router.replace("/(onboarding)/pair-success");
    } catch (error) {
      setPairingState({
        status: "error",
        error: toUserMessage(error),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const setDigitAt = (index: number, value: string) => {
    setDigits((previous) => {
      const next = [...previous];
      next[index] = value;
      return next;
    });
  };

  const handleChange = (index: number, value: string) => {
    const numeric = value.replace(/\D/g, "");
    if (numeric.length === 0) {
      setDigitAt(index, "");
      return;
    }

    if (numeric.length > 1) {
      const nextDigits = [...digits];
      for (let offset = 0; offset < numeric.length && index + offset < CODE_LENGTH; offset += 1) {
        nextDigits[index + offset] = numeric[offset] ?? "";
      }
      setDigits(nextDigits);

      const finalCode = nextDigits.join("");
      if (finalCode.length === CODE_LENGTH) {
        void submitCode(finalCode);
      } else {
        const nextIndex = Math.min(CODE_LENGTH - 1, index + numeric.length);
        inputRefs.current[nextIndex]?.focus();
      }

      return;
    }

    setDigitAt(index, numeric);
    if (index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    const candidate = [...digits];
    candidate[index] = numeric;
    if (candidate.join("").length === CODE_LENGTH) {
      void submitCode(candidate.join(""));
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && digits[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Confirm Pairing</Text>
        <Text style={styles.subtitle}>Enter the 6-digit code shown by your Orchestra runtime.</Text>
        <Text style={styles.runtime}>{pairing.host ?? "No runtime selected"}</Text>

        <View style={styles.codeRow}>
          {digits.map((digit, index) => (
            <ThemedTextInput
              key={`pair-digit-${index}`}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={index === 0 ? CODE_LENGTH : 1}
              onChangeText={(value: string) => handleChange(index, value)}
              onKeyPress={(event: { nativeEvent: { key: string } }) => handleKeyPress(index, event.nativeEvent.key)}
              ref={(instance: RNTextInput | null) => {
                inputRefs.current[index] = instance;
              }}
              style={styles.codeInput}
              textContentType={index === 0 ? "oneTimeCode" : "none"}
              value={digit}
            />
          ))}
        </View>

        <Text style={styles.countdown}>Expires in {formatCountdown(remainingMs)}</Text>
        {pairing.error ?
          <Text style={styles.error}>{pairing.error}</Text>
        : null}

        <Button disabled={!canSubmit} onPress={() => void submitCode()}>
          {isSubmitting ?
            <ActivityIndicator color={theme.colors.background} />
          : "Confirm Pairing"}
        </Button>

        <Button onPress={() => router.replace("/(onboarding)/find-runtime")} variant="outline">
          Start Over
        </Button>
      </View>
    </SafeAreaView>
  );
}
