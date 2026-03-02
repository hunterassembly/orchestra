import type {
  PermissionModeDTO,
  SessionCommandDTO,
  SessionDTO,
  SessionEventDTO,
} from "@craft-agent/mobile-contracts";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createRuntimeApiClient } from "@/api/runtime-client";
import { createInMemorySseCursorStore, createSseClient, type MobileSseClient } from "@/api/sse-client";
import { Badge, Button, ConnectionChip, TextInput } from "@/components/ui";
import { authStore, useAuthStore } from "@/state/auth-store";
import { type SessionMessage } from "@/state/session-types";
import { useSessionsStore } from "@/state/sessions";
import { useTheme } from "@/theme/theme-provider";

type PendingSend = {
  optimisticId: string;
  text: string;
  timestamp: number;
};

function toSessionId(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatAbsoluteTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${normalizedHours}:${minutes} ${suffix}`;
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unable to complete request.";
}

function connectionTone(
  streamState: "connecting" | "connected" | "reconnecting" | "offline",
  hasError: boolean,
): "connected" | "reconnecting" | "offline" | "idle" {
  if (hasError) {
    return "offline";
  }

  if (streamState === "connected") {
    return "connected";
  }

  if (streamState === "connecting" || streamState === "reconnecting") {
    return "reconnecting";
  }

  return "offline";
}

function connectionLabel(streamState: "connecting" | "connected" | "reconnecting" | "offline"): string {
  if (streamState === "connected") {
    return "Connected";
  }

  if (streamState === "connecting") {
    return "Connecting";
  }

  if (streamState === "reconnecting") {
    return "Reconnecting";
  }

  return "Offline";
}

function messageBubbleVariant(message: SessionMessage): "user" | "assistant" | "status" | "error" | "tool" {
  if (message.role === "user") {
    return "user";
  }

  if (message.role === "tool") {
    return "tool";
  }

  if (message.role === "error") {
    return "error";
  }

  if (message.role === "status" || message.role === "info" || message.role === "warning" || message.role === "plan") {
    return "status";
  }

  return "assistant";
}

function buildOptimisticUserMessage(optimisticId: string, text: string): SessionMessage {
  const timestamp = Date.now();

  return {
    id: optimisticId,
    role: "user",
    content: text,
    timestamp,
    toolName: null,
    toolUseId: null,
    toolInput: null,
    toolResult: null,
    toolStatus: null,
    isStreaming: false,
    isPending: true,
    isIntermediate: false,
  };
}

function clampInput(value: string): string {
  return value.replace(/\s+$/u, (match) => match.replace(/\n+$/u, "\n"));
}

export default function SessionScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = toSessionId(params.sessionId);

  const runtimeHost = useAuthStore((state) => state.runtimeHost ?? state.pairing.host);
  const triggerRePair = useAuthStore((state) => state.triggerRePair);

  const record = useSessionsStore((state) => (sessionId ? state.sessionsById[sessionId] : undefined));
  const setSessionDetail = useSessionsStore((state) => state.setSessionDetail);
  const appendMessage = useSessionsStore((state) => state.appendMessage);
  const updateMessage = useSessionsStore((state) => state.updateMessage);
  const upsertSession = useSessionsStore((state) => state.upsertSession);
  const removeSession = useSessionsStore((state) => state.deleteSession);
  const applyEvent = useSessionsStore((state) => state.applyEvent);

  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting" | "offline">("connecting");
  const [pendingQueue, setPendingQueue] = useState<PendingSend[]>([]);
  const [expandedToolMessageIds, setExpandedToolMessageIds] = useState<Record<string, boolean>>({});
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);

  const sseClientRef = useRef<MobileSseClient | null>(null);
  const listRef = useRef<FlatList<SessionMessage>>(null);
  const reconnectAttemptRef = useRef(0);

  const client = useMemo(() => {
    return runtimeHost ? createRuntimeApiClient(runtimeHost) : null;
  }, [runtimeHost]);

  const ThemedTextInput = TextInput as unknown as any;

  const session = record?.session;
  const messages = record?.messages ?? [];
  const sessionWorkspaceId = session?.workspaceId ?? null;
  const isProcessing = Boolean(session?.isProcessing);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const pruneDeliveredPendingQueue = useCallback(() => {
    setPendingQueue((current) => {
      return current.filter((queued) => {
        const optimisticMessage = messages.find((message) => message.id === queued.optimisticId);
        if (optimisticMessage) {
          return optimisticMessage.isPending;
        }

        const deliveredReplacement = messages.some((message) => {
          if (message.role !== "user" || message.isPending) {
            return false;
          }

          if (message.content !== queued.text) {
            return false;
          }

          return Math.abs(message.timestamp - queued.timestamp) <= 120_000;
        });

        return !deliveredReplacement;
      });
    });
  }, [messages]);

  useEffect(() => {
    pruneDeliveredPendingQueue();
  }, [messages, pruneDeliveredPendingQueue]);

  const fetchSessionDetail = useCallback(async () => {
    if (!sessionId || !client) {
      setIsLoading(false);
      if (!sessionId) {
        setErrorMessage("Missing session id.");
      } else {
        setErrorMessage("Runtime host unavailable.");
      }
      setStreamState("offline");
      return;
    }

    setIsLoading(true);

    try {
      setErrorMessage(null);
      const detail = await client.getSession(sessionId);
      setSessionDetail(sessionId, detail);

      if (detail.hasUnread) {
        void client.sendCommand(sessionId, { type: "markRead" }).catch(() => undefined);
        upsertSession({ ...detail, hasUnread: false });
      }
    } catch (error) {
      setErrorMessage(toUserMessage(error));
      setStreamState("offline");
    } finally {
      setIsLoading(false);
    }
  }, [client, sessionId, setSessionDetail, upsertSession]);

  const sendWithQueue = useCallback(
    async (payload: PendingSend, options?: { optimisticMessageAlreadyExists?: boolean }) => {
      if (!sessionId || !client) {
        setErrorMessage("Runtime connection unavailable.");
        return false;
      }

      if (!options?.optimisticMessageAlreadyExists) {
        appendMessage(sessionId, buildOptimisticUserMessage(payload.optimisticId, payload.text));
      }

      try {
        await client.sendMessage(sessionId, payload.text, {
          optimisticMessageId: payload.optimisticId,
        });

        setPendingQueue((current) => current.filter((entry) => entry.optimisticId !== payload.optimisticId));
        return true;
      } catch (error) {
        setErrorMessage(toUserMessage(error));

        setPendingQueue((current) => {
          if (current.some((entry) => entry.optimisticId === payload.optimisticId)) {
            return current;
          }

          return [...current, payload];
        });

        updateMessage(sessionId, payload.optimisticId, {
          isPending: true,
        });
        return false;
      }
    },
    [appendMessage, client, sessionId, updateMessage],
  );

  const replayPendingQueue = useCallback(async () => {
    if (!sessionId || pendingQueue.length === 0) {
      return;
    }

    for (const queued of pendingQueue) {
      await sendWithQueue(queued, { optimisticMessageAlreadyExists: true });
    }
  }, [pendingQueue, sendWithQueue, sessionId]);

  useEffect(() => {
    void fetchSessionDetail();
  }, [fetchSessionDetail]);

  useEffect(() => {
    if (!client || !sessionWorkspaceId || !sessionId) {
      return;
    }

    setStreamState("connecting");

    const sseClient = createSseClient({
      baseUrl: runtimeHost ?? "",
      authStore: {
        getAccessToken: () => authStore.getState().getAccessToken(),
      },
      cursorStore: createInMemorySseCursorStore(),
      onOpen: () => {
        reconnectAttemptRef.current = 0;
        setStreamState("connected");
        void replayPendingQueue();
      },
      onEvent: (event: SessionEventDTO) => {
        applyEvent(event);
      },
      onError: (error) => {
        setStreamState("reconnecting");
        setErrorMessage(error.message);
      },
      onReconnectScheduled: () => {
        reconnectAttemptRef.current += 1;
        setStreamState("reconnecting");
      },
    });

    sseClientRef.current = sseClient;

    void sseClient.connect(sessionWorkspaceId).catch((error: unknown) => {
      setStreamState("offline");
      setErrorMessage(toUserMessage(error));
    });

    return () => {
      sseClient.disconnect();
      sseClientRef.current = null;
    };
  }, [applyEvent, client, replayPendingQueue, runtimeHost, sessionId, sessionWorkspaceId]);

  useEffect(() => {
    if (!autoFollow) {
      return;
    }

    scrollToBottom(isProcessing);
  }, [autoFollow, isProcessing, messages.length, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (isSending || !sessionId) {
      return;
    }

    const text = clampInput(composerText).trim();
    if (!text) {
      return;
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload: PendingSend = {
      optimisticId,
      text,
      timestamp: Date.now(),
    };

    setComposerText("");
    setIsSending(true);
    setErrorMessage(null);

    try {
      await sendWithQueue(payload);
      setAutoFollow(true);
      scrollToBottom(true);
    } finally {
      setIsSending(false);
    }
  }, [composerText, isSending, scrollToBottom, sendWithQueue, sessionId]);

  const handleInterrupt = useCallback(async () => {
    if (!sessionId || !client || isInterrupting) {
      return;
    }

    setIsInterrupting(true);

    try {
      await client.interrupt(sessionId);
    } catch (error) {
      setErrorMessage(toUserMessage(error));
    } finally {
      setIsInterrupting(false);
    }
  }, [client, isInterrupting, sessionId]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const threshold = 96;
    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - threshold;

    setIsAtBottom(nearBottom);
    setAutoFollow(nearBottom);
  }, []);

  const toggleToolExpand = useCallback((messageId: string) => {
    setExpandedToolMessageIds((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  }, []);

  const sendCommand = useCallback(
    async (command: SessionCommandDTO, optimisticUpdate?: () => void) => {
      if (!sessionId || !client) {
        return;
      }

      try {
        await client.sendCommand(sessionId, command);
        optimisticUpdate?.();
      } catch (error) {
        setErrorMessage(toUserMessage(error));
      }
    },
    [client, sessionId],
  );

  const promptRename = useCallback(() => {
    if (!session || !sessionId) {
      return;
    }

    Alert.prompt(
      "Rename Session",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: (nextName?: string) => {
            const trimmed = (nextName ?? "").trim();
            if (!trimmed || trimmed === (session.name ?? "")) {
              return;
            }

            void sendCommand({ type: "rename", name: trimmed }, () => {
              upsertSession({
                ...session,
                name: trimmed,
              });
            });
          },
        },
      ],
      "plain-text",
      session.name ?? "",
    );
  }, [sendCommand, session, sessionId, upsertSession]);

  const promptStatus = useCallback(() => {
    if (!session) {
      return;
    }

    const updateStatus = (state: string) => {
      void sendCommand({ type: "setSessionStatus", state }, () => {
        upsertSession({
          ...session,
          sessionStatus: state,
          isProcessing: state.toLowerCase() === "running",
        });
      });
    };

    Alert.alert("Set Session Status", "Choose a status", [
      { text: "Running", onPress: () => updateStatus("running") },
      { text: "Idle", onPress: () => updateStatus("idle") },
      { text: "Waiting", onPress: () => updateStatus("waiting") },
      { text: "Error", onPress: () => updateStatus("error") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [sendCommand, session, upsertSession]);

  const promptPermissionMode = useCallback(() => {
    if (!session) {
      return;
    }

    const setMode = (mode: PermissionModeDTO) => {
      void sendCommand({ type: "setPermissionMode", mode }, () => {
        upsertSession({
          ...session,
          permissionMode: mode,
        });
      });
    };

    Alert.alert("Permission Mode", "Select execution mode", [
      { text: "Safe", onPress: () => setMode("safe") },
      { text: "Ask", onPress: () => setMode("ask") },
      { text: "Allow All", onPress: () => setMode("allow-all") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [sendCommand, session, upsertSession]);

  const promptDelete = useCallback(() => {
    if (!sessionId || !client) {
      return;
    }

    Alert.alert("Delete Session", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await client.deleteSession(sessionId);
              removeSession(sessionId);
              router.back();
            } catch (error) {
              setErrorMessage(toUserMessage(error));
            }
          })();
        },
      },
    ]);
  }, [client, removeSession, router, sessionId]);

  const openHeaderMenu = useCallback(() => {
    Alert.alert(session?.name ?? "Session", "Actions", [
      { text: "Rename", onPress: () => promptRename() },
      { text: "Set Status", onPress: () => promptStatus() },
      { text: "Permission Mode", onPress: () => promptPermissionMode() },
      { text: "Delete", style: "destructive", onPress: () => promptDelete() },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [promptDelete, promptPermissionMode, promptRename, promptStatus, session?.name]);

  const showAttachmentPicker = useCallback(() => {
    Alert.alert("Attachments", "Attachment picker ships in Step 5.");
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: theme.colors.background,
          flex: 1,
        },
        container: {
          flex: 1,
        },
        header: {
          alignItems: "center",
          borderBottomColor: theme.colors.navigator,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: theme.spacing.xs,
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        },
        headerLeft: {
          alignItems: "center",
          flexDirection: "row",
          flexShrink: 1,
          gap: theme.spacing.xs,
        },
        titleWrap: {
          flexShrink: 1,
          gap: 2,
        },
        title: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: "700",
          lineHeight: theme.typography.body.lineHeight,
        },
        subtitle: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
        },
        headerRight: {
          alignItems: "center",
          flexDirection: "row",
          gap: theme.spacing.xs,
        },
        body: {
          flex: 1,
        },
        errorBanner: {
          backgroundColor: theme.colors.paper,
          borderBottomColor: theme.colors.destructive,
          borderBottomWidth: 1,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        },
        errorText: {
          color: theme.colors.destructive,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
        },
        timelineContent: {
          gap: theme.spacing.sm,
          paddingBottom: theme.spacing.lg,
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.md,
        },
        rowBase: {
          marginBottom: theme.spacing.sm,
        },
        rowUser: {
          alignItems: "flex-end",
        },
        rowAssistant: {
          alignItems: "flex-start",
        },
        bubbleBase: {
          borderColor: theme.colors.foreground,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          maxWidth: "94%",
          minWidth: "32%",
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
        },
        bubbleUser: {
          backgroundColor: theme.colors.navigator,
        },
        bubbleAssistant: {
          backgroundColor: theme.colors.paper,
        },
        bubbleStatus: {
          backgroundColor: theme.colors.background,
          borderColor: theme.colors.navigator,
        },
        bubbleError: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.destructive,
        },
        bubbleTool: {
          backgroundColor: theme.colors.paper,
        },
        messageText: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
        },
        codeText: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
        },
        pendingText: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          marginTop: 4,
        },
        messageMeta: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          marginTop: 4,
          textAlign: "right",
        },
        toolHeader: {
          alignItems: "center",
          flexDirection: "row",
          gap: theme.spacing.xs,
          justifyContent: "space-between",
        },
        toolTitle: {
          color: theme.colors.foreground,
          flexShrink: 1,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: "700",
          lineHeight: theme.typography.body.lineHeight,
        },
        toolBody: {
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          gap: theme.spacing.xs,
          marginTop: theme.spacing.xs,
          paddingTop: theme.spacing.xs,
        },
        jumpToLiveWrap: {
          alignItems: "center",
          bottom: 88,
          position: "absolute",
          right: theme.spacing.md,
        },
        composerWrap: {
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          flexDirection: "row",
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
        },
        composerInputWrap: {
          flex: 1,
        },
        composerInput: {
          maxHeight: 120,
          minHeight: 44,
          textAlignVertical: "top",
        },
        loadingWrap: {
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
        },
        pendingQueueBar: {
          alignItems: "center",
          backgroundColor: theme.colors.paper,
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        },
      }),
    [theme],
  );

  const renderMessage = ({ item }: { item: SessionMessage }) => {
    const variant = messageBubbleVariant(item);
    const isToolExpanded = Boolean(expandedToolMessageIds[item.id]);

    const rowStyle = variant === "user" ? styles.rowUser : styles.rowAssistant;
    const bubbleStyle =
      variant === "user"
        ? styles.bubbleUser
        : variant === "status"
          ? styles.bubbleStatus
          : variant === "error"
            ? styles.bubbleError
            : variant === "tool"
              ? styles.bubbleTool
              : styles.bubbleAssistant;

    if (variant === "tool") {
      return (
        <View style={[styles.rowBase, rowStyle]}>
          <Pressable
            onPress={() => toggleToolExpand(item.id)}
            style={[styles.bubbleBase, bubbleStyle]}
          >
            <View style={styles.toolHeader}>
              <Text numberOfLines={1} style={styles.toolTitle}>
                {item.toolName ?? "Tool"}
              </Text>
              <Badge variant={item.toolStatus === "error" ? "destructive" : "outline"}>
                {item.toolStatus ?? "executing"}
              </Badge>
            </View>

            {isToolExpanded ? (
              <View style={styles.toolBody}>
                {item.toolInput ? (
                  <>
                    <Text style={styles.subtitle}>Input</Text>
                    <Text style={styles.codeText}>{JSON.stringify(item.toolInput, null, 2)}</Text>
                  </>
                ) : null}

                {item.toolResult ? (
                  <>
                    <Text style={styles.subtitle}>Result</Text>
                    <Text style={styles.messageText}>{item.toolResult}</Text>
                  </>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.messageMeta}>{formatAbsoluteTime(item.timestamp)}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={[styles.rowBase, rowStyle]}>
        <View style={[styles.bubbleBase, bubbleStyle]}>
          <Text style={styles.messageText}>{item.content}</Text>
          {item.isPending ? <Text style={styles.pendingText}>Pending...</Text> : null}
          <Text style={styles.messageMeta}>{formatAbsoluteTime(item.timestamp)}</Text>
        </View>
      </View>
    );
  };

  const currentConnectionTone = connectionTone(streamState, Boolean(errorMessage));

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
        style={styles.container}
      >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Button onPress={() => router.back()} size="icon" variant="outline">
              Back
            </Button>

            <View style={styles.titleWrap}>
              <Text numberOfLines={1} style={styles.title}>
                {session?.name ?? "Session"}
              </Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {sessionId ?? "unknown"}
              </Text>
            </View>
          </View>

          <View style={styles.headerRight}>
            <ConnectionChip
              label={connectionLabel(streamState)}
              onPress={() => {
                Alert.alert(
                  "Connection",
                  [
                    `Host: ${runtimeHost ?? "not configured"}`,
                    `Stream: ${streamState}`,
                    `Reconnect attempts: ${reconnectAttemptRef.current}`,
                  ].join("\n"),
                );
              }}
              tone={currentConnectionTone}
            />
            <Button onPress={() => openHeaderMenu()} size="icon" variant="outline">
              ...
            </Button>
          </View>
        </View>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.body}>
          {isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          ) : (
            <>
              <FlatList
                contentContainerStyle={styles.timelineContent}
                data={messages}
                keyExtractor={(item) => item.id}
                onContentSizeChange={() => {
                  if (autoFollow) {
                    scrollToBottom(isProcessing);
                  }
                }}
                onScroll={handleScroll}
                ref={listRef}
                renderItem={renderMessage}
                scrollEventThrottle={16}
              />

              {isProcessing && !isAtBottom ? (
                <View style={styles.jumpToLiveWrap}>
                  <Button
                    onPress={() => {
                      setAutoFollow(true);
                      setIsAtBottom(true);
                      scrollToBottom(true);
                    }}
                    size="sm"
                  >
                    Jump to Live
                  </Button>
                </View>
              ) : null}
            </>
          )}
        </View>

        {pendingQueue.length > 0 ? (
          <View style={styles.pendingQueueBar}>
            <Text style={styles.subtitle}>Queued sends: {pendingQueue.length}</Text>
            <Button onPress={() => void replayPendingQueue()} size="sm" variant="outline">
              Retry
            </Button>
          </View>
        ) : null}

        <View style={styles.composerWrap}>
          <Button onPress={() => showAttachmentPicker()} size="icon" variant="outline">
            +
          </Button>

          <View style={styles.composerInputWrap}>
            <ThemedTextInput
              multiline
              onChangeText={setComposerText}
              onSubmitEditing={() => {
                if (!isProcessing) {
                  void handleSend();
                }
              }}
              placeholder="Message Orchestra..."
              style={styles.composerInput}
              value={composerText}
            />
          </View>

          {isProcessing ? (
            <Button
              disabled={isInterrupting}
              onPress={() => void handleInterrupt()}
              size="default"
              variant="destructive"
            >
              {isInterrupting ? <ActivityIndicator color={theme.colors.background} /> : "Stop"}
            </Button>
          ) : (
            <Button
              disabled={isSending || clampInput(composerText).trim().length === 0}
              onPress={() => void handleSend()}
              size="default"
            >
              {isSending ? <ActivityIndicator color={theme.colors.background} /> : "Send"}
            </Button>
          )}
        </View>

        <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.xs }}>
          <Button onPress={() => void triggerRePair()} variant="ghost">
            Re-pair Device
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
