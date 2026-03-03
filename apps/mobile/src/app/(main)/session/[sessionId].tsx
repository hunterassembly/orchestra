import type {
  CredentialInputModeDTO,
  CredentialRequestDTO,
  CredentialResponseDTO,
  PermissionModeDTO,
  PermissionRequestDTO,
  PermissionResponseDTO,
  SessionCommandDTO,
  SessionDTO,
  SessionEventDTO,
} from "@craft-agent/mobile-contracts";
import { File } from "expo-file-system";
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
  attachmentIds: string[];
};

type TimelineItem =
  | { kind: "message"; key: string; message: SessionMessage }
  | { kind: "permission"; key: string; request: PermissionRequestDTO }
  | { kind: "credential"; key: string; request: CredentialRequestDTO };

type RequestActionState = {
  isSubmitting: boolean;
  error: string | null;
};

type CredentialFormState = RequestActionState & {
  value: string;
  username: string;
  password: string;
  headers: Record<string, string>;
};

type AttachmentDraft = {
  localId: string;
  name: string;
  mimeType: string;
  size: number;
  data: string;
  status: "uploading" | "ready" | "error";
  attachmentId?: string;
  error: string | null;
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

function isCancelledError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalized = error.message.toLowerCase();
  return normalized.includes("cancel");
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

function messageBubbleVariant(
  message: SessionMessage,
): "user" | "assistant" | "status" | "info" | "warning" | "plan" | "error" | "tool" {
  if (message.role === "user") {
    return "user";
  }

  if (message.role === "tool") {
    return "tool";
  }

  if (message.role === "error") {
    return "error";
  }

  if (message.role === "status") {
    return "status";
  }

  if (message.role === "warning") {
    return "warning";
  }

  if (message.role === "plan") {
    return "plan";
  }

  if (message.role === "info") {
    if (message.infoLevel === "warning") {
      return "warning";
    }
    if (message.infoLevel === "error") {
      return "error";
    }
    if (message.infoLevel === "success") {
      return "plan";
    }

    return "info";
  }

  return "assistant";
}

function sessionStatusLabel(session: SessionDTO | undefined): string {
  if (!session) {
    return "idle";
  }

  if (session.isProcessing) {
    return "running";
  }

  if (!session.sessionStatus || session.sessionStatus.trim().length === 0) {
    return "idle";
  }

  return session.sessionStatus.trim().toLowerCase();
}

function sessionStatusBadgeVariant(session: SessionDTO | undefined): "default" | "secondary" | "destructive" | "outline" {
  const normalized = sessionStatusLabel(session);

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

function permissionModeLabel(mode: PermissionModeDTO | null | undefined): string {
  if (mode === "allow-all") {
    return "auto";
  }
  if (mode === "safe") {
    return "safe";
  }
  if (mode === "ask") {
    return "ask";
  }

  return "ask";
}

function truncate(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function summarizeToolInput(input: Record<string, unknown> | null): string | null {
  if (!input) {
    return null;
  }

  try {
    return truncate(JSON.stringify(input), 120);
  } catch {
    return null;
  }
}

function summarizeToolResult(result: string | null): string | null {
  if (!result || result.trim().length === 0) {
    return null;
  }

  return truncate(result.replace(/\s+/g, " "), 120);
}

function toolStatusBadgeVariant(status: SessionMessage["toolStatus"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error") {
    return "destructive";
  }
  if (status === "executing" || status === "backgrounded") {
    return "default";
  }
  if (status === "pending") {
    return "secondary";
  }

  return "outline";
}

function eventLabel(variant: ReturnType<typeof messageBubbleVariant>): string | null {
  if (variant === "status") {
    return "Status";
  }
  if (variant === "info") {
    return "Info";
  }
  if (variant === "warning") {
    return "Warning";
  }
  if (variant === "plan") {
    return "Plan";
  }
  if (variant === "error") {
    return "Error";
  }

  return null;
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

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function deriveFileName(uri: string): string {
  const candidate = uri.split("/").pop() ?? "";
  if (!candidate) {
    return `attachment-${Date.now()}`;
  }

  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
}

function guessMimeType(name: string, fallback: string): string {
  if (fallback.trim().length > 0) {
    return fallback;
  }

  const normalized = name.trim().toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".pdf")) return "application/pdf";
  if (normalized.endsWith(".md")) return "text/markdown";
  if (normalized.endsWith(".json")) return "application/json";
  if (normalized.endsWith(".txt")) return "text/plain";

  return "application/octet-stream";
}

function credentialMode(request: CredentialRequestDTO): CredentialInputModeDTO {
  return request.inputMode ?? "bearer";
}

function createCredentialFormState(request: CredentialRequestDTO): CredentialFormState {
  const headers: Record<string, string> = {};

  const explicitHeaders = request.headerNames ?? [];
  for (const header of explicitHeaders) {
    if (header.trim().length > 0) {
      headers[header] = "";
    }
  }

  if (request.headerName && request.headerName.trim().length > 0 && !(request.headerName in headers)) {
    headers[request.headerName] = "";
  }

  return {
    value: "",
    username: "",
    password: "",
    headers,
    isSubmitting: false,
    error: null,
  };
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
  const dequeuePermissionRequest = useSessionsStore((state) => state.dequeuePermissionRequest);
  const dequeueCredentialRequest = useSessionsStore((state) => state.dequeueCredentialRequest);
  const applyEvent = useSessionsStore((state) => state.applyEvent);

  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting" | "offline">("connecting");
  const [pendingQueue, setPendingQueue] = useState<PendingSend[]>([]);
  const [expandedToolMessageIds, setExpandedToolMessageIds] = useState<Record<string, boolean>>({});
  const [permissionActionById, setPermissionActionById] = useState<Record<string, RequestActionState>>({});
  const [credentialFormById, setCredentialFormById] = useState<Record<string, CredentialFormState>>({});
  const [attachmentDrafts, setAttachmentDrafts] = useState<AttachmentDraft[]>([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);

  const sseClientRef = useRef<MobileSseClient | null>(null);
  const listRef = useRef<FlatList<TimelineItem>>(null);
  const reconnectAttemptRef = useRef(0);

  const client = useMemo(() => {
    return runtimeHost ? createRuntimeApiClient(runtimeHost) : null;
  }, [runtimeHost]);

  const ThemedTextInput = TextInput as unknown as any;

  const session = record?.session;
  const messages = record?.messages ?? [];
  const permissionRequests = record?.permissionRequests ?? [];
  const credentialRequests = record?.credentialRequests ?? [];
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

  useEffect(() => {
    const activeRequestIds = new Set(permissionRequests.map((request) => request.requestId));
    setPermissionActionById((current) => {
      let changed = false;
      const next: Record<string, RequestActionState> = {};

      for (const [requestId, state] of Object.entries(current)) {
        if (activeRequestIds.has(requestId)) {
          next[requestId] = state;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [permissionRequests]);

  useEffect(() => {
    const activeRequestIds = new Set(credentialRequests.map((request) => request.requestId));
    setCredentialFormById((current) => {
      let changed = false;
      const next: Record<string, CredentialFormState> = {};

      for (const [requestId, state] of Object.entries(current)) {
        if (activeRequestIds.has(requestId)) {
          next[requestId] = state;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [credentialRequests]);

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = messages.map((message) => ({
      kind: "message",
      key: `message:${message.id}`,
      message,
    }));

    for (const request of permissionRequests) {
      items.push({
        kind: "permission",
        key: `permission:${request.requestId}`,
        request,
      });
    }

    for (const request of credentialRequests) {
      items.push({
        kind: "credential",
        key: `credential:${request.requestId}`,
        request,
      });
    }

    return items;
  }, [credentialRequests, messages, permissionRequests]);

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
        }, payload.attachmentIds.map((attachmentId) => ({ id: attachmentId })));

        setPendingQueue((current) => current.filter((entry) => entry.optimisticId !== payload.optimisticId));
        if (payload.attachmentIds.length > 0) {
          setAttachmentDrafts((current) =>
            current.filter((draft) => {
              if (draft.status !== "ready" || !draft.attachmentId) {
                return true;
              }

              return !payload.attachmentIds.includes(draft.attachmentId);
            }),
          );
        }
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
  }, [autoFollow, isProcessing, scrollToBottom, timelineItems.length]);

  const handleSend = useCallback(async () => {
    if (isSending || !sessionId) {
      return;
    }

    const text = clampInput(composerText).trim();
    if (!text) {
      return;
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const readyAttachmentIds = attachmentDrafts
      .filter((draft) => draft.status === "ready" && typeof draft.attachmentId === "string")
      .map((draft) => draft.attachmentId as string);
    const payload: PendingSend = {
      optimisticId,
      text,
      timestamp: Date.now(),
      attachmentIds: readyAttachmentIds,
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
  }, [attachmentDrafts, composerText, isSending, scrollToBottom, sendWithQueue, sessionId]);

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

  const handleRepairDevice = useCallback(() => {
    void (async () => {
      await triggerRePair();
      router.replace("/(onboarding)/find-runtime");
    })();
  }, [router, triggerRePair]);

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

  const respondToPermissionRequest = useCallback(async (request: PermissionRequestDTO, response: PermissionResponseDTO) => {
    if (!sessionId || !client) {
      return;
    }

    setPermissionActionById((current) => ({
      ...current,
      [request.requestId]: {
        isSubmitting: true,
        error: null,
      },
    }));

    try {
      await client.respondToPermission(sessionId, request.requestId, response);
      dequeuePermissionRequest(sessionId, request.requestId);
    } catch (error) {
      const message = toUserMessage(error);
      setErrorMessage(message);
      setPermissionActionById((current) => ({
        ...current,
        [request.requestId]: {
          isSubmitting: false,
          error: message,
        },
      }));
      return;
    }

    setPermissionActionById((current) => ({
      ...current,
      [request.requestId]: {
        isSubmitting: false,
        error: null,
      },
    }));
  }, [client, dequeuePermissionRequest, sessionId]);

  const updateCredentialForm = useCallback((request: CredentialRequestDTO, updater: (state: CredentialFormState) => CredentialFormState) => {
    setCredentialFormById((current) => {
      const baseline = current[request.requestId] ?? createCredentialFormState(request);
      return {
        ...current,
        [request.requestId]: updater(baseline),
      };
    });
  }, []);

  const respondToCredentialRequest = useCallback(async (request: CredentialRequestDTO, response: CredentialResponseDTO) => {
    if (!sessionId || !client) {
      return;
    }

    updateCredentialForm(request, (state) => ({
      ...state,
      isSubmitting: true,
      error: null,
    }));

    try {
      await client.respondToCredential(sessionId, request.requestId, response);
      dequeueCredentialRequest(sessionId, request.requestId);
      setCredentialFormById((current) => {
        if (!(request.requestId in current)) {
          return current;
        }

        const next = { ...current };
        delete next[request.requestId];
        return next;
      });
      return;
    } catch (error) {
      const message = toUserMessage(error);
      setErrorMessage(message);
      updateCredentialForm(request, (state) => ({
        ...state,
        isSubmitting: false,
        error: message,
      }));
      return;
    }
  }, [client, dequeueCredentialRequest, sessionId, updateCredentialForm]);

  const submitCredentialRequest = useCallback(async (request: CredentialRequestDTO) => {
    const currentState = credentialFormById[request.requestId] ?? createCredentialFormState(request);
    const mode = credentialMode(request);

    let response: CredentialResponseDTO;
    if (mode === "basic") {
      const username = currentState.username.trim();
      const password = currentState.password.trim();
      if (username.length === 0 || (request.passwordRequired !== false && password.length === 0)) {
        updateCredentialForm(request, (state) => ({
          ...state,
          error: "Username and password are required.",
        }));
        return;
      }

      response = {
        type: "credential",
        username,
        password,
        cancelled: false,
      };
    } else if (mode === "multi-header") {
      const headers = Object.entries(currentState.headers).reduce<Record<string, string>>((acc, [key, value]) => {
        const nextValue = value.trim();
        if (nextValue.length > 0) {
          acc[key] = nextValue;
        }
        return acc;
      }, {});

      if (Object.keys(headers).length === 0) {
        updateCredentialForm(request, (state) => ({
          ...state,
          error: "Enter at least one credential header value.",
        }));
        return;
      }

      response = {
        type: "credential",
        headers,
        cancelled: false,
      };
    } else {
      const value = currentState.value.trim();
      if (value.length === 0) {
        updateCredentialForm(request, (state) => ({
          ...state,
          error: "Credential value is required.",
        }));
        return;
      }

      response = {
        type: "credential",
        value,
        cancelled: false,
      };
    }

    await respondToCredentialRequest(request, response);
  }, [credentialFormById, respondToCredentialRequest, updateCredentialForm]);

  const uploadAttachmentDraft = useCallback(async (draft: AttachmentDraft) => {
    if (!sessionId || !client) {
      return;
    }

    setAttachmentDrafts((current) =>
      current.map((currentDraft) =>
        currentDraft.localId === draft.localId
          ? {
              ...currentDraft,
              status: "uploading",
              error: null,
            }
          : currentDraft,
      ),
    );

    try {
      const uploaded = await client.uploadAttachment(sessionId, {
        name: draft.name,
        mimeType: draft.mimeType,
        data: draft.data,
      });

      setAttachmentDrafts((current) =>
        current.map((currentDraft) =>
          currentDraft.localId === draft.localId
            ? {
                ...currentDraft,
                status: "ready",
                error: null,
                attachmentId: uploaded.id,
                size: uploaded.size,
                mimeType: uploaded.mimeType,
              }
            : currentDraft,
        ),
      );
    } catch (error) {
      const message = toUserMessage(error);
      setErrorMessage(message);
      setAttachmentDrafts((current) =>
        current.map((currentDraft) =>
          currentDraft.localId === draft.localId
            ? {
                ...currentDraft,
                status: "error",
                error: message,
              }
            : currentDraft,
        ),
      );
    }
  }, [client, sessionId]);

  const retryAttachmentUpload = useCallback((localId: string) => {
    const draft = attachmentDrafts.find((item) => item.localId === localId);
    if (!draft) {
      return;
    }

    void uploadAttachmentDraft(draft);
  }, [attachmentDrafts, uploadAttachmentDraft]);

  const removeAttachmentDraft = useCallback((localId: string) => {
    setAttachmentDrafts((current) => current.filter((draft) => draft.localId !== localId));
  }, []);

  const showAttachmentPicker = useCallback(() => {
    if (!sessionId || !client) {
      setErrorMessage("Runtime connection unavailable.");
      return;
    }

    void (async () => {
      try {
        const picked = await File.pickFileAsync();
        const file = Array.isArray(picked) ? picked[0] : picked;
        if (!file) {
          return;
        }

        const name = deriveFileName(file.uri);
        const mimeType = guessMimeType(name, file.type ?? "");
        const data = await file.base64();

        const draft: AttachmentDraft = {
          localId: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          name,
          mimeType,
          size: file.size,
          data,
          status: "uploading",
          error: null,
        };

        setAttachmentDrafts((current) => [...current, draft]);
        await uploadAttachmentDraft(draft);
      } catch (error) {
        if (isCancelledError(error)) {
          return;
        }

        setErrorMessage(toUserMessage(error));
      }
    })();
  }, [client, sessionId, uploadAttachmentDraft]);

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
        headerMetaRow: {
          alignItems: "center",
          backgroundColor: theme.colors.paper,
          borderBottomColor: theme.colors.navigator,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
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
        metaText: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          opacity: 0.7,
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
        rowStatus: {
          alignItems: "center",
        },
        bubbleBase: {
          borderColor: theme.colors.navigator,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          maxWidth: "94%",
          minWidth: "32%",
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.sm,
        },
        bubbleUser: {
          backgroundColor: theme.colors.accent,
          borderColor: theme.colors.accent,
        },
        bubbleAssistant: {
          backgroundColor: theme.colors.paper,
        },
        bubbleStatus: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.navigator,
          maxWidth: "100%",
        },
        bubbleInfo: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.info,
          maxWidth: "100%",
        },
        bubbleWarning: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.destructive,
          maxWidth: "100%",
        },
        bubblePlan: {
          backgroundColor: theme.colors.paper,
          borderColor: theme.colors.accent,
          maxWidth: "100%",
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
        userMessageText: {
          color: theme.colors.background,
        },
        errorMessageText: {
          color: theme.colors.destructive,
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
        userMeta: {
          color: theme.colors.background,
          opacity: 0.75,
        },
        eventLabel: {
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: "700",
          lineHeight: theme.typography.mono.lineHeight,
          marginBottom: 4,
          opacity: 0.85,
          textTransform: "uppercase",
        },
        eventLabelStatus: {
          color: theme.colors.info,
        },
        eventLabelInfo: {
          color: theme.colors.info,
        },
        eventLabelWarning: {
          color: theme.colors.destructive,
        },
        eventLabelPlan: {
          color: theme.colors.accent,
        },
        eventLabelError: {
          color: theme.colors.destructive,
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
        toolPreviewBlock: {
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          gap: 2,
          marginTop: theme.spacing.xs,
          paddingTop: theme.spacing.xs,
        },
        toolPreviewLine: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          opacity: 0.75,
        },
        toolExpandHint: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          marginTop: theme.spacing.xs,
        },
        sectionLabel: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: "700",
          lineHeight: theme.typography.mono.lineHeight,
          textTransform: "uppercase",
        },
        assistantStreaming: {
          color: theme.colors.accent,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          marginTop: 4,
        },
        intermediateText: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
          marginTop: 4,
          opacity: 0.9,
        },
        toolBody: {
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          gap: theme.spacing.xs,
          marginTop: theme.spacing.xs,
          paddingTop: theme.spacing.xs,
        },
        requestBadgeRow: {
          alignItems: "center",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.xs,
          marginBottom: theme.spacing.xs,
        },
        requestActions: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.xs,
          marginTop: theme.spacing.sm,
        },
        requestErrorText: {
          color: theme.colors.destructive,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          marginTop: theme.spacing.xs,
        },
        credentialForm: {
          gap: theme.spacing.xs,
          marginTop: theme.spacing.sm,
        },
        jumpToLiveWrap: {
          alignItems: "center",
          bottom: 88,
          position: "absolute",
          right: theme.spacing.md,
        },
        attachmentQueue: {
          backgroundColor: theme.colors.paper,
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
        attachmentRow: {
          alignItems: "center",
          borderColor: theme.colors.navigator,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          flexDirection: "row",
          gap: theme.spacing.xs,
          justifyContent: "space-between",
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: theme.spacing.xs,
        },
        attachmentMeta: {
          flex: 1,
          gap: 2,
        },
        attachmentName: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.fontSize.sm,
          fontWeight: "700",
          lineHeight: theme.typography.body.lineHeight,
        },
        attachmentDetail: {
          color: theme.colors.info,
          fontFamily: theme.typography.mono.fontFamily,
          fontSize: theme.typography.fontSize.xs,
          fontWeight: theme.typography.mono.fontWeight,
          lineHeight: theme.typography.mono.lineHeight,
        },
        attachmentActions: {
          alignItems: "center",
          flexDirection: "row",
          gap: theme.spacing.xs,
        },
        composerWrap: {
          backgroundColor: theme.colors.paper,
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
        emptyTimeline: {
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing["2xl"],
        },
        emptyTimelineText: {
          color: theme.colors.foreground,
          fontFamily: theme.typography.body.fontFamily,
          fontSize: theme.typography.body.fontSize,
          fontWeight: theme.typography.body.fontWeight,
          lineHeight: theme.typography.body.lineHeight,
          opacity: 0.75,
          textAlign: "center",
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
        footer: {
          borderTopColor: theme.colors.navigator,
          borderTopWidth: 1,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.xs,
        },
      }),
    [theme],
  );

  const renderMessage = ({ item }: { item: SessionMessage }) => {
    const variant = messageBubbleVariant(item);
    const isToolExpanded = Boolean(expandedToolMessageIds[item.id]);
    const itemEventLabel = eventLabel(variant);

    const rowStyle =
      variant === "user"
        ? styles.rowUser
        : variant === "status" || variant === "info" || variant === "warning" || variant === "plan"
          ? styles.rowStatus
          : styles.rowAssistant;
    const bubbleStyle =
      variant === "user"
        ? styles.bubbleUser
        : variant === "status"
          ? styles.bubbleStatus
          : variant === "info"
            ? styles.bubbleInfo
            : variant === "warning"
              ? styles.bubbleWarning
              : variant === "plan"
                ? styles.bubblePlan
          : variant === "error"
            ? styles.bubbleError
            : variant === "tool"
              ? styles.bubbleTool
              : styles.bubbleAssistant;

    if (variant === "tool") {
      const inputPreview = summarizeToolInput(item.toolInput);
      const resultPreview = summarizeToolResult(item.toolResult);

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
              <Badge variant={toolStatusBadgeVariant(item.toolStatus)}>
                {item.toolStatus ?? "executing"}
              </Badge>
            </View>

            {!isToolExpanded && (inputPreview || resultPreview) ? (
              <View style={styles.toolPreviewBlock}>
                {inputPreview ? <Text style={styles.toolPreviewLine}>in: {inputPreview}</Text> : null}
                {resultPreview ? <Text style={styles.toolPreviewLine}>out: {resultPreview}</Text> : null}
              </View>
            ) : null}

            {isToolExpanded ? (
              <View style={styles.toolBody}>
                {item.toolInput ? (
                  <>
                    <Text style={styles.sectionLabel}>Input</Text>
                    <Text style={styles.codeText}>{JSON.stringify(item.toolInput, null, 2)}</Text>
                  </>
                ) : null}

                {item.toolResult ? (
                  <>
                    <Text style={styles.sectionLabel}>Result</Text>
                    <Text style={styles.messageText}>{item.toolResult}</Text>
                  </>
                ) : null}
              </View>
            ) : null}

            {!isToolExpanded ? <Text style={styles.toolExpandHint}>Tap to expand</Text> : null}
            <Text style={styles.messageMeta}>{formatAbsoluteTime(item.timestamp)}</Text>
          </Pressable>
        </View>
      );
    }

    const messageTextStyle =
      variant === "user"
        ? styles.userMessageText
        : variant === "error"
          ? styles.errorMessageText
          : undefined;
    const messageMetaStyle = variant === "user" ? styles.userMeta : undefined;
    const eventLabelStyle =
      variant === "warning"
        ? styles.eventLabelWarning
        : variant === "plan"
          ? styles.eventLabelPlan
          : variant === "status"
            ? styles.eventLabelStatus
            : variant === "info"
              ? styles.eventLabelInfo
              : variant === "error"
                ? styles.eventLabelError
                : undefined;

    return (
      <View style={[styles.rowBase, rowStyle]}>
        <View style={[styles.bubbleBase, bubbleStyle]}>
          {itemEventLabel ? <Text style={[styles.eventLabel, eventLabelStyle]}>{itemEventLabel}</Text> : null}
          <Text style={[styles.messageText, messageTextStyle]}>{item.content}</Text>
          {item.role === "assistant" && item.isStreaming ? (
            <Text style={styles.assistantStreaming}>Streaming...</Text>
          ) : null}
          {item.isIntermediate ? <Text style={styles.intermediateText}>Intermediate output</Text> : null}
          {item.isPending ? <Text style={styles.pendingText}>Pending...</Text> : null}
          <Text style={[styles.messageMeta, messageMetaStyle]}>{formatAbsoluteTime(item.timestamp)}</Text>
        </View>
      </View>
    );
  };

  const renderPermissionRequest = (request: PermissionRequestDTO) => {
    const actionState = permissionActionById[request.requestId] ?? {
      isSubmitting: false,
      error: null,
    };

    return (
      <View style={[styles.rowBase, styles.rowStatus]}>
        <View style={[styles.bubbleBase, styles.bubbleWarning]}>
          <Text style={[styles.eventLabel, styles.eventLabelWarning]}>Permission Request</Text>
          <View style={styles.requestBadgeRow}>
            <Badge variant="outline">{request.toolName || "Tool"}</Badge>
            {request.type ? <Badge variant="secondary">{request.type}</Badge> : null}
          </View>
          <Text style={styles.messageText}>{request.description}</Text>
          {request.command ? <Text style={styles.codeText}>{request.command}</Text> : null}

          <View style={styles.requestActions}>
            <Button
              disabled={actionState.isSubmitting}
              onPress={() => {
                void respondToPermissionRequest(request, {
                  allowed: false,
                  alwaysAllow: false,
                });
              }}
              size="sm"
              variant="destructive"
            >
              Deny
            </Button>
            <Button
              disabled={actionState.isSubmitting}
              onPress={() => {
                void respondToPermissionRequest(request, {
                  allowed: true,
                  alwaysAllow: false,
                });
              }}
              size="sm"
              variant="secondary"
            >
              Allow Once
            </Button>
            <Button
              disabled={actionState.isSubmitting}
              onPress={() => {
                void respondToPermissionRequest(request, {
                  allowed: true,
                  alwaysAllow: true,
                  options: {
                    rememberForMinutes: 15,
                  },
                });
              }}
              size="sm"
            >
              Allow 15m
            </Button>
          </View>

          {actionState.error ? <Text style={styles.requestErrorText}>{actionState.error}</Text> : null}
          {actionState.isSubmitting ? <Text style={styles.pendingText}>Submitting...</Text> : null}
        </View>
      </View>
    );
  };

  const renderCredentialRequest = (request: CredentialRequestDTO) => {
    const mode = credentialMode(request);
    const formState = credentialFormById[request.requestId] ?? createCredentialFormState(request);
    const submitting = formState.isSubmitting;

    const headerKeys = Object.keys(formState.headers).length > 0
      ? Object.keys(formState.headers)
      : request.headerNames?.length
        ? request.headerNames
        : request.headerName
          ? [request.headerName]
          : ["Authorization"];

    return (
      <View style={[styles.rowBase, styles.rowStatus]}>
        <View style={[styles.bubbleBase, styles.bubbleInfo]}>
          <Text style={[styles.eventLabel, styles.eventLabelInfo]}>Credential Request</Text>
          <View style={styles.requestBadgeRow}>
            <Badge variant="outline">{request.sourceName ?? request.sourceSlug ?? "Source"}</Badge>
            <Badge variant="secondary">{mode}</Badge>
          </View>

          {request.description ? <Text style={styles.messageText}>{request.description}</Text> : null}
          {request.hint ? <Text style={styles.intermediateText}>{request.hint}</Text> : null}

          <View style={styles.credentialForm}>
            {mode === "basic" ? (
              <>
                <ThemedTextInput
                  autoCapitalize="none"
                  onChangeText={(value: string) => {
                    updateCredentialForm(request, (state) => ({
                      ...state,
                      username: value,
                      error: null,
                    }));
                  }}
                  placeholder={request.labels?.username ?? "Username"}
                  value={formState.username}
                />
                <ThemedTextInput
                  autoCapitalize="none"
                  onChangeText={(value: string) => {
                    updateCredentialForm(request, (state) => ({
                      ...state,
                      password: value,
                      error: null,
                    }));
                  }}
                  placeholder={request.labels?.password ?? "Password"}
                  secureTextEntry
                  value={formState.password}
                />
              </>
            ) : mode === "multi-header" ? (
              <>
                {headerKeys.map((headerKey) => (
                  <ThemedTextInput
                    autoCapitalize="none"
                    key={`${request.requestId}:${headerKey}`}
                    onChangeText={(value: string) => {
                      updateCredentialForm(request, (state) => ({
                        ...state,
                        headers: {
                          ...state.headers,
                          [headerKey]: value,
                        },
                        error: null,
                      }));
                    }}
                    placeholder={`${headerKey} value`}
                    value={formState.headers[headerKey] ?? ""}
                  />
                ))}
              </>
            ) : (
              <ThemedTextInput
                autoCapitalize="none"
                onChangeText={(value: string) => {
                  updateCredentialForm(request, (state) => ({
                    ...state,
                    value,
                    error: null,
                  }));
                }}
                placeholder={request.labels?.credential ?? "Credential value"}
                value={formState.value}
              />
            )}
          </View>

          <View style={styles.requestActions}>
            <Button
              disabled={submitting}
              onPress={() => {
                void respondToCredentialRequest(request, {
                  type: "credential",
                  cancelled: true,
                });
              }}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={submitting}
              onPress={() => {
                void submitCredentialRequest(request);
              }}
              size="sm"
            >
              Submit
            </Button>
          </View>

          {formState.error ? <Text style={styles.requestErrorText}>{formState.error}</Text> : null}
          {submitting ? <Text style={styles.pendingText}>Submitting...</Text> : null}
        </View>
      </View>
    );
  };

  const renderTimelineItem = ({ item }: { item: TimelineItem }) => {
    if (item.kind === "message") {
      return renderMessage({ item: item.message });
    }

    if (item.kind === "permission") {
      return renderPermissionRequest(item.request);
    }

    return renderCredentialRequest(item.request);
  };

  const currentConnectionTone = connectionTone(streamState, Boolean(errorMessage));
  const statusLabel = sessionStatusLabel(session);

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
        <View style={styles.headerMetaRow}>
          <Badge variant={sessionStatusBadgeVariant(session)}>{statusLabel}</Badge>
          <Badge variant="outline">mode: {permissionModeLabel(session?.permissionMode)}</Badge>
          <Text numberOfLines={1} style={styles.metaText}>
            {messages.length} messages · {permissionRequests.length + credentialRequests.length} requests
          </Text>
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
                data={timelineItems}
                keyExtractor={(item) => item.key}
                ListEmptyComponent={
                  <View style={styles.emptyTimeline}>
                    <Text style={styles.emptyTimelineText}>
                      No messages yet. Send your first prompt to continue this session on mobile.
                    </Text>
                  </View>
                }
                onContentSizeChange={() => {
                  if (autoFollow) {
                    scrollToBottom(isProcessing);
                  }
                }}
                onScroll={handleScroll}
                ref={listRef}
                renderItem={renderTimelineItem}
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

        {attachmentDrafts.length > 0 ? (
          <View style={styles.attachmentQueue}>
            {attachmentDrafts.map((attachment) => (
              <View key={attachment.localId} style={styles.attachmentRow}>
                <View style={styles.attachmentMeta}>
                  <Text numberOfLines={1} style={styles.attachmentName}>
                    {attachment.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.attachmentDetail}>
                    {formatBytes(attachment.size)} · {attachment.status}
                  </Text>
                  {attachment.error ? <Text style={styles.requestErrorText}>{attachment.error}</Text> : null}
                </View>

                <View style={styles.attachmentActions}>
                  {attachment.status === "error" ? (
                    <Button
                      onPress={() => retryAttachmentUpload(attachment.localId)}
                      size="sm"
                      variant="outline"
                    >
                      Retry
                    </Button>
                  ) : null}
                  <Button
                    onPress={() => removeAttachmentDraft(attachment.localId)}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </View>
              </View>
            ))}
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

        <View style={styles.footer}>
          <Button onPress={() => handleRepairDevice()} variant="ghost">
            Re-pair Device
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
