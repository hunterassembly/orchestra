import type { PermissionModeDTO, SessionCommandDTO, SessionDTO, WorkspaceDTO } from "@craft-agent/mobile-contracts";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createRuntimeApiClient } from "@/api/runtime-client";
import { Badge, Button, ConnectionChip } from "@/components/ui";
import { useAuthStore } from "@/state/auth-store";
import { useSessionsStore } from "@/state/sessions";
import { useTheme } from "@/theme/theme-provider";

const SWIPE_ACTION_WIDTH = 108;
const SWIPE_OPEN_THRESHOLD = 54;

function formatRelativeTime(timestamp: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (elapsedSeconds < 60) {
    return "now";
  }

  if (elapsedSeconds < 3_600) {
    return `${Math.floor(elapsedSeconds / 60)}m`;
  }

  if (elapsedSeconds < 86_400) {
    return `${Math.floor(elapsedSeconds / 3_600)}h`;
  }

  if (elapsedSeconds < 604_800) {
    return `${Math.floor(elapsedSeconds / 86_400)}d`;
  }

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unable to reach the runtime right now.";
}

function normalizeStatus(session: SessionDTO): string {
  if (session.isProcessing) {
    return "running";
  }

  if (!session.sessionStatus || session.sessionStatus.trim().length === 0) {
    return "idle";
  }

  return session.sessionStatus.trim().toLowerCase();
}

function statusLabel(session: SessionDTO): string {
  const normalized = normalizeStatus(session);

  if (normalized === "running") {
    return "running";
  }
  if (normalized === "waiting") {
    return "waiting";
  }
  if (normalized === "error") {
    return "error";
  }

  return "idle";
}

function statusVariant(session: SessionDTO): "default" | "secondary" | "destructive" | "outline" {
  const normalized = normalizeStatus(session);

  if (normalized === "running") {
    return "default";
  }
  if (normalized === "waiting") {
    return "secondary";
  }
  if (normalized === "error") {
    return "destructive";
  }

  return "outline";
}

function applyStatusPatch(session: SessionDTO, status: string): SessionDTO {
  return {
    ...session,
    sessionStatus: status,
    isProcessing: status.toLowerCase() === "running",
  };
}

function sortSessionsByRecency(sessions: SessionDTO[]): SessionDTO[] {
  return [...sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

type SessionListItemProps = {
  session: SessionDTO;
  workspaceName: string;
  now: number;
  disabled: boolean;
  pending: boolean;
  onOpen: (session: SessionDTO) => void;
  onToggleRead: (session: SessionDTO) => void;
  onDelete: (session: SessionDTO) => void;
  onLongPress: (session: SessionDTO) => void;
};

function SessionListItem({
  session,
  workspaceName,
  now,
  disabled,
  pending,
  onOpen,
  onToggleRead,
  onDelete,
  onLongPress,
}: SessionListItemProps) {
  const theme = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStartX = useRef(0);
  const currentX = useRef(0);

  useEffect(() => {
    const subscriptionId = translateX.addListener(({ value }) => {
      currentX.current = value;
    });

    return () => {
      translateX.removeListener(subscriptionId);
    };
  }, [translateX]);

  const animateTo = useCallback(
    (value: number) => {
      Animated.spring(translateX, {
        toValue: value,
        damping: 18,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
    [translateX],
  );

  const closeRow = useCallback(() => {
    animateTo(0);
  }, [animateTo]);

  const handlePress = useCallback(() => {
    if (Math.abs(currentX.current) > 8) {
      closeRow();
      return;
    }

    onOpen(session);
  }, [closeRow, onOpen, session]);

  const handleToggleRead = useCallback(() => {
    closeRow();
    onToggleRead(session);
  }, [closeRow, onToggleRead, session]);

  const handleDelete = useCallback(() => {
    closeRow();
    onDelete(session);
  }, [closeRow, onDelete, session]);

  const onPanGrant = useCallback(() => {
    translateX.stopAnimation((value) => {
      dragStartX.current = value;
    });
  }, [translateX]);

  const onPanMove = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const nextValue = Math.max(
        -SWIPE_ACTION_WIDTH,
        Math.min(SWIPE_ACTION_WIDTH, dragStartX.current + gesture.dx),
      );
      translateX.setValue(nextValue);
    },
    [translateX],
  );

  const onPanRelease = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const projected = dragStartX.current + gesture.dx;

      if (projected <= -SWIPE_OPEN_THRESHOLD) {
        animateTo(-SWIPE_ACTION_WIDTH);
        return;
      }

      if (projected >= SWIPE_OPEN_THRESHOLD) {
        animateTo(SWIPE_ACTION_WIDTH);
        return;
      }

      closeRow();
    },
    [animateTo, closeRow],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => {
          return Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
        },
        onPanResponderGrant: onPanGrant,
        onPanResponderMove: onPanMove,
        onPanResponderRelease: onPanRelease,
        onPanResponderTerminate: closeRow,
        onPanResponderTerminationRequest: () => true,
      }),
    [closeRow, onPanGrant, onPanMove, onPanRelease],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginBottom: theme.spacing.sm,
        },
        swipeBackground: {
          bottom: 0,
          flexDirection: "row",
          justifyContent: "space-between",
          left: 0,
          position: "absolute",
          right: 0,
          top: 0,
        },
        actionSlot: {
          justifyContent: "center",
          width: SWIPE_ACTION_WIDTH,
        },
        actionButton: {
          minHeight: 64,
        },
        card: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.foreground,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          gap: theme.spacing.xs,
          minHeight: 84,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
        },
        row: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
        },
        titleWrap: {
          alignItems: "center",
          flexDirection: "row",
          flexShrink: 1,
          gap: theme.spacing.xs,
          marginRight: theme.spacing.sm,
        },
        unreadDot: {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.sm,
          height: theme.spacing.sm,
          width: theme.spacing.sm,
        },
        title: {
          color: theme.colors.foreground,
          flexShrink: 1,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: "700",
          lineHeight: theme.typography.body.lineHeight,
        },
        timestamp: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
        },
        subtitleRow: {
          alignItems: "center",
          flexDirection: "row",
          gap: theme.spacing.xs,
          justifyContent: "space-between",
        },
        subtitle: {
          color: theme.colors.foreground,
          flexShrink: 1,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          opacity: 0.75,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.container}>
      <View style={styles.swipeBackground}>
        <View style={styles.actionSlot}>
          <Button
            disabled={disabled || pending}
            onPress={() => handleDelete()}
            size="sm"
            style={styles.actionButton}
            variant="destructive"
          >
            Delete
          </Button>
        </View>

        <View style={styles.actionSlot}>
          <Button
            disabled={disabled || pending}
            onPress={() => handleToggleRead()}
            size="sm"
            style={styles.actionButton}
            variant="secondary"
          >
            {session.hasUnread ? "Mark Read" : "Mark Unread"}
          </Button>
        </View>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <View>
          <Pressable
            disabled={pending}
            onLongPress={() => onLongPress(session)}
            onPress={handlePress}
            style={styles.card}
          >
            <View style={styles.row}>
              <View style={styles.titleWrap}>
                {session.hasUnread ? <View style={styles.unreadDot} /> : null}
                <Text numberOfLines={1} style={styles.title}>
                  {session.name ?? "Untitled Session"}
                </Text>
              </View>
              <Text style={styles.timestamp}>{formatRelativeTime(session.lastMessageAt, now)}</Text>
            </View>

            <View style={styles.subtitleRow}>
              <Text numberOfLines={1} style={styles.subtitle}>
                {workspaceName}
              </Text>
              <Badge variant={statusVariant(session)}>{statusLabel(session)}</Badge>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

export default function MainIndexScreen() {
  const router = useRouter();
  const theme = useTheme();
  const runtimeHost = useAuthStore((state) => state.runtimeHost ?? state.pairing.host);
  const triggerRePair = useAuthStore((state) => state.triggerRePair);

  const activeWorkspaceId = useSessionsStore((state) => state.activeWorkspaceId);
  const sessionOrder = useSessionsStore((state) => state.sessionOrder);
  const sessionsById = useSessionsStore((state) => state.sessionsById);
  const setActiveWorkspaceId = useSessionsStore((state) => state.setActiveWorkspaceId);
  const setSessions = useSessionsStore((state) => state.setSessions);
  const upsertSession = useSessionsStore((state) => state.upsertSession);
  const removeSession = useSessionsStore((state) => state.deleteSession);

  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const client = useMemo(() => {
    return runtimeHost ? createRuntimeApiClient(runtimeHost) : null;
  }, [runtimeHost]);

  const sessions = useMemo(() => {
    return sessionOrder
      .map((sessionId) => sessionsById[sessionId]?.session)
      .filter((session): session is SessionDTO => {
        if (!session) {
          return false;
        }

        if (!activeWorkspaceId) {
          return true;
        }

        return session.workspaceId === activeWorkspaceId;
      })
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }, [activeWorkspaceId, sessionOrder, sessionsById]);

  const workspaceNameById = useMemo(() => {
    return new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  }, [workspaces]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const fetchSessionsForWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!client) {
        return;
      }

      const sessionList = await client.getSessions(workspaceId);
      setSessions(sortSessionsByRecency(sessionList));
    },
    [client, setSessions],
  );

  const fetchHomeData = useCallback(
    async (options?: { refreshing?: boolean }) => {
      if (!client) {
        setErrorMessage("Runtime host missing. Re-pair this device.");
        setIsInitialLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (options?.refreshing) {
        setIsRefreshing(true);
      } else {
        setIsInitialLoading(true);
      }

      try {
        setErrorMessage(null);

        const workspaceList = await client.getWorkspaces();
        setWorkspaces(workspaceList);

        if (workspaceList.length === 0) {
          setActiveWorkspaceId(null);
          setSessions([]);
          setLastSyncAt(Date.now());
          return;
        }

        const selectedWorkspaceId =
          activeWorkspaceId && workspaceList.some((workspace) => workspace.id === activeWorkspaceId)
            ? activeWorkspaceId
            : workspaceList[0]?.id ?? null;

        setActiveWorkspaceId(selectedWorkspaceId);

        if (!selectedWorkspaceId) {
          setSessions([]);
          setLastSyncAt(Date.now());
          return;
        }

        await fetchSessionsForWorkspace(selectedWorkspaceId);
        setLastSyncAt(Date.now());
      } catch (error) {
        setErrorMessage(toUserMessage(error));
      } finally {
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeWorkspaceId, client, fetchSessionsForWorkspace, setActiveWorkspaceId, setSessions],
  );

  useEffect(() => {
    void fetchHomeData();
  }, [fetchHomeData]);

  const handleRefresh = useCallback(() => {
    void fetchHomeData({ refreshing: true });
  }, [fetchHomeData]);

  const handleRepairDevice = useCallback(() => {
    void (async () => {
      await triggerRePair();
      router.replace("/(onboarding)/find-runtime");
    })();
  }, [router, triggerRePair]);

  const handleSelectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!client) {
        return;
      }

      setActiveWorkspaceId(workspaceId);
      setIsRefreshing(true);

      try {
        setErrorMessage(null);
        await fetchSessionsForWorkspace(workspaceId);
        setLastSyncAt(Date.now());
      } catch (error) {
        setErrorMessage(toUserMessage(error));
      } finally {
        setIsRefreshing(false);
      }
    },
    [client, fetchSessionsForWorkspace, setActiveWorkspaceId],
  );

  const patchSession = useCallback(
    (sessionId: string, patch: Partial<SessionDTO>) => {
      const current = sessionsById[sessionId]?.session;
      if (!current) {
        return;
      }

      upsertSession({
        ...current,
        ...patch,
      });
    },
    [sessionsById, upsertSession],
  );

  const sendSessionCommand = useCallback(
    async (
      session: SessionDTO,
      command: SessionCommandDTO,
      optimisticUpdate?: () => void,
    ) => {
      if (!client) {
        setErrorMessage("Runtime connection unavailable.");
        return;
      }

      setPendingSessionId(session.id);

      try {
        await client.sendCommand(session.id, command);
        optimisticUpdate?.();
      } catch (error) {
        setErrorMessage(toUserMessage(error));
      } finally {
        setPendingSessionId(null);
      }
    },
    [client],
  );

  const handleToggleRead = useCallback(
    (session: SessionDTO) => {
      const hasUnread = session.hasUnread;
      const command: SessionCommandDTO = hasUnread ? { type: "markRead" } : { type: "markUnread" };

      void sendSessionCommand(session, command, () => {
        patchSession(session.id, {
          hasUnread: !hasUnread,
        });
      });
    },
    [patchSession, sendSessionCommand],
  );

  const handleDeleteSession = useCallback(
    (session: SessionDTO) => {
      if (!client) {
        return;
      }

      Alert.alert(
        "Delete Session",
        "This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              setPendingSessionId(session.id);

              void (async () => {
                try {
                  await client.deleteSession(session.id);
                  removeSession(session.id);
                } catch (error) {
                  setErrorMessage(toUserMessage(error));
                } finally {
                  setPendingSessionId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [client, removeSession],
  );

  const promptRenameSession = useCallback(
    (session: SessionDTO) => {
      Alert.prompt(
        "Rename Session",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: (nextName?: string) => {
              const trimmedName = (nextName ?? "").trim();
              if (!trimmedName || trimmedName === (session.name ?? "")) {
                return;
              }

              void sendSessionCommand(session, { type: "rename", name: trimmedName }, () => {
                patchSession(session.id, {
                  name: trimmedName,
                });
              });
            },
          },
        ],
        "plain-text",
        session.name ?? "",
      );
    },
    [patchSession, sendSessionCommand],
  );

  const promptStatus = useCallback(
    (session: SessionDTO) => {
      Alert.alert("Set Session Status", "Choose a status", [
        {
          text: "Running",
          onPress: () => {
            void sendSessionCommand(session, { type: "setSessionStatus", state: "running" }, () => {
              upsertSession(applyStatusPatch(session, "running"));
            });
          },
        },
        {
          text: "Idle",
          onPress: () => {
            void sendSessionCommand(session, { type: "setSessionStatus", state: "idle" }, () => {
              upsertSession(applyStatusPatch(session, "idle"));
            });
          },
        },
        {
          text: "Waiting",
          onPress: () => {
            void sendSessionCommand(session, { type: "setSessionStatus", state: "waiting" }, () => {
              upsertSession(applyStatusPatch(session, "waiting"));
            });
          },
        },
        {
          text: "Error",
          onPress: () => {
            void sendSessionCommand(session, { type: "setSessionStatus", state: "error" }, () => {
              upsertSession(applyStatusPatch(session, "error"));
            });
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [sendSessionCommand, upsertSession],
  );

  const promptPermissionMode = useCallback(
    (session: SessionDTO) => {
      const setMode = (mode: PermissionModeDTO) => {
        void sendSessionCommand(session, { type: "setPermissionMode", mode }, () => {
          patchSession(session.id, { permissionMode: mode });
        });
      };

      Alert.alert("Permission Mode", "Select the execution policy", [
        { text: "Safe", onPress: () => setMode("safe") },
        { text: "Ask", onPress: () => setMode("ask") },
        { text: "Allow All", onPress: () => setMode("allow-all") },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [patchSession, sendSessionCommand],
  );

  const handleLongPressSession = useCallback(
    (session: SessionDTO) => {
      Alert.alert(session.name ?? "Session", "Choose an action", [
        {
          text: session.hasUnread ? "Mark Read" : "Mark Unread",
          onPress: () => handleToggleRead(session),
        },
        {
          text: "Rename",
          onPress: () => promptRenameSession(session),
        },
        {
          text: "Set Status",
          onPress: () => promptStatus(session),
        },
        {
          text: "Permission Mode",
          onPress: () => promptPermissionMode(session),
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => handleDeleteSession(session),
        },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [handleDeleteSession, handleToggleRead, promptPermissionMode, promptRenameSession, promptStatus],
  );

  const handleCreateSession = useCallback(() => {
    if (!client || !activeWorkspaceId) {
      return;
    }

    setIsCreatingSession(true);

    void (async () => {
      try {
        setErrorMessage(null);
        const createdSession = await client.createSession(activeWorkspaceId, {});
        upsertSession(createdSession);
        router.push(`/(main)/session/${createdSession.id}`);
      } catch (error) {
        setErrorMessage(toUserMessage(error));
      } finally {
        setIsCreatingSession(false);
      }
    })();
  }, [activeWorkspaceId, client, router, upsertSession]);

  const connectionTone = useMemo(() => {
    if (!runtimeHost || errorMessage) {
      return "offline" as const;
    }

    if (isInitialLoading || isRefreshing || isCreatingSession || Boolean(pendingSessionId)) {
      return "reconnecting" as const;
    }

    return "connected" as const;
  }, [errorMessage, isCreatingSession, isInitialLoading, isRefreshing, pendingSessionId, runtimeHost]);

  const connectionLabel = useMemo(() => {
    if (connectionTone === "connected") {
      return "Connected";
    }

    if (connectionTone === "reconnecting") {
      return "Syncing";
    }

    return "Offline";
  }, [connectionTone]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: theme.colors.background,
          flex: 1,
        },
        container: {
          flex: 1,
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.md,
        },
        header: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: theme.spacing.sm,
        },
        title: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.heading.fontFamily,
          fontSize: theme.typography.heading.fontSize,
          fontWeight: theme.typography.heading.fontWeight,
          lineHeight: theme.typography.heading.lineHeight,
        },
        headerActions: {
          alignItems: "center",
          flexDirection: "row",
          gap: theme.spacing.xs,
        },
        workspaceRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.xs,
          marginBottom: theme.spacing.sm,
        },
        workspaceButton: {
          minHeight: 32,
        },
        alertBanner: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.destructive,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          marginBottom: theme.spacing.sm,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
        alertText: {
          color: theme.colors.destructive,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
        },
        listContent: {
          paddingBottom: theme.spacing.xl,
        },
        emptyState: {
          alignItems: "center",
          gap: theme.spacing.sm,
          justifyContent: "center",
          marginTop: theme.spacing["2xl"],
          paddingHorizontal: theme.spacing.lg,
        },
        emptyTitle: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.heading.fontFamily,
          fontSize: theme.typography.fontSize.lg,
          fontWeight: theme.typography.heading.fontWeight,
          lineHeight: theme.typography.heading.lineHeight,
          textAlign: "center",
        },
        emptySubtitle: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          opacity: 0.8,
          textAlign: "center",
        },
        loadingWrap: {
          gap: theme.spacing.sm,
          marginTop: theme.spacing.sm,
        },
        loadingCard: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.navigator,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          minHeight: 84,
          opacity: 0.7,
        },
        syncMeta: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          marginBottom: theme.spacing.xs,
        },
      }),
    [theme],
  );

  const renderEmptyState = () => {
    if (isInitialLoading) {
      return (
        <View style={styles.loadingWrap}>
          <View style={styles.loadingCard} />
          <View style={styles.loadingCard} />
          <View style={styles.loadingCard} />
        </View>
      );
    }

    if (connectionTone === "offline") {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Runtime Unreachable</Text>
          <Text style={styles.emptySubtitle}>
            Keep Orchestra running on your Mac and verify both devices are on the same network.
          </Text>
          <Button onPress={() => handleRefresh()} variant="outline">
            Retry Connection
          </Button>
          <Button onPress={() => handleRepairDevice()} variant="ghost">
            Re-pair Device
          </Button>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No Sessions Yet</Text>
        <Text style={styles.emptySubtitle}>Create your first session and continue it on iPhone.</Text>
        <Button disabled={isCreatingSession || !activeWorkspaceId} onPress={() => handleCreateSession()}>
          {isCreatingSession ? <ActivityIndicator color={theme.colors.background} /> : "Create Session"}
        </Button>
      </View>
    );
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Sessions</Text>

          <View style={styles.headerActions}>
            <ConnectionChip
              label={connectionLabel}
              onPress={() => {
                Alert.alert(
                  "Connection Status",
                  [
                    `Host: ${runtimeHost ?? "not configured"}`,
                    `State: ${connectionLabel}`,
                    `Workspaces: ${workspaces.length}`,
                    `Last Sync: ${lastSyncAt ? formatRelativeTime(lastSyncAt, now) : "never"}`,
                  ].join("\n"),
                );
              }}
              tone={connectionTone}
            />

            <Button
              disabled={!activeWorkspaceId || isCreatingSession || connectionTone === "offline"}
              onPress={() => handleCreateSession()}
              size="icon"
            >
              {isCreatingSession ? <ActivityIndicator color={theme.colors.background} /> : "+"}
            </Button>
          </View>
        </View>

        <View style={styles.workspaceRow}>
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            return (
              <Button
                key={workspace.id}
                onPress={() => void handleSelectWorkspace(workspace.id)}
                size="sm"
                style={styles.workspaceButton}
                variant={active ? "default" : "outline"}
              >
                {workspace.name}
              </Button>
            );
          })}
        </View>

        {errorMessage ? (
          <View style={styles.alertBanner}>
            <Text style={styles.alertText}>{errorMessage}</Text>
          </View>
        ) : null}

        {lastSyncAt ? <Text style={styles.syncMeta}>Last sync: {formatRelativeTime(lastSyncAt, now)}</Text> : null}

        <FlatList
          contentContainerStyle={styles.listContent}
          data={sessions}
          keyExtractor={(session) => session.id}
          ListEmptyComponent={renderEmptyState}
          refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} />}
          renderItem={({ item }) => {
            return (
              <SessionListItem
                disabled={connectionTone === "offline"}
                now={now}
                onDelete={handleDeleteSession}
                onLongPress={handleLongPressSession}
                onOpen={(session) => router.push(`/(main)/session/${session.id}`)}
                onToggleRead={handleToggleRead}
                pending={pendingSessionId === item.id}
                session={item}
                workspaceName={workspaceNameById.get(item.workspaceId) ?? item.workspaceId}
              />
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}
