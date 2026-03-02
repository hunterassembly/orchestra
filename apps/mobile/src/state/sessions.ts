import type {
  CredentialRequestDTO,
  MessageDTO,
  PermissionRequestDTO,
  SessionDTO,
  SessionEventDTO,
} from "@craft-agent/mobile-contracts";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import {
  createEmptySessionsSnapshot,
  processSessionEvent,
  type SessionRecord,
  type SessionsSnapshot,
} from "@/state/event-processor";
import { createSessionRecord, type SessionMessage } from "@/state/session-types";

type SessionDetail = SessionDTO & {
  messages?: MessageDTO[];
};

export type SessionsStoreState = SessionsSnapshot & {
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  getSessionById: (sessionId: string) => SessionRecord | undefined;
  getSessionsForWorkspace: (workspaceId?: string | null) => SessionDTO[];
  setSessions: (sessions: SessionDTO[]) => void;
  upsertSession: (session: SessionDTO) => void;
  deleteSession: (sessionId: string) => void;
  setSessionDetail: (sessionId: string, detail: SessionDetail) => void;
  appendMessage: (sessionId: string, message: MessageDTO) => void;
  updateMessage: (sessionId: string, messageId: string, patch: Partial<MessageDTO>) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  enqueuePermissionRequest: (sessionId: string, request: PermissionRequestDTO) => void;
  dequeuePermissionRequest: (sessionId: string, requestId: string) => void;
  enqueueCredentialRequest: (sessionId: string, request: CredentialRequestDTO) => void;
  dequeueCredentialRequest: (sessionId: string, requestId: string) => void;
  applyEvent: (event: SessionEventDTO) => void;
  reset: () => void;
};

function syncRecordSession(record: SessionRecord): SessionRecord {
  const previewCandidate = [...record.messages]
    .reverse()
    .find((message) =>
      (message.role === "assistant" || message.role === "user") && message.content.trim().length > 0,
    );

  return {
    ...record,
    session: {
      ...record.session,
      messageCount: record.messages.length,
      preview: previewCandidate?.content ?? record.session.preview,
      messages: record.messages,
      lastMessageAt:
        record.messages.length > 0
          ? Math.max(
              record.session.lastMessageAt,
              record.messages[record.messages.length - 1]?.timestamp ?? 0,
            )
          : record.session.lastMessageAt,
    },
  };
}

function mutateRecord(
  snapshot: SessionsSnapshot,
  sessionId: string,
  updater: (record: SessionRecord) => SessionRecord,
): SessionsSnapshot {
  const existing = snapshot.sessionsById[sessionId];
  if (!existing) {
    return snapshot;
  }

  const updated = syncRecordSession(
    updater({
      ...existing,
      session: { ...existing.session },
      messages: [...existing.messages],
      permissionRequests: [...existing.permissionRequests],
      credentialRequests: [...existing.credentialRequests],
      streaming: existing.streaming ? { ...existing.streaming } : null,
      sessionMetadata: { ...existing.sessionMetadata },
    }),
  );

  return {
    ...snapshot,
    sessionsById: {
      ...snapshot.sessionsById,
      [sessionId]: updated,
    },
  };
}

export function createSessionsStore() {
  return createStore<SessionsStoreState>((set, get) => ({
    ...createEmptySessionsSnapshot(),

    setActiveWorkspaceId: (workspaceId) => {
      set({ activeWorkspaceId: workspaceId });
    },

    getSessionById: (sessionId) => {
      return get().sessionsById[sessionId];
    },

    getSessionsForWorkspace: (workspaceId) => {
      const state = get();
      const targetWorkspaceId = workspaceId ?? state.activeWorkspaceId;

      return state.sessionOrder
        .map((sessionId) => state.sessionsById[sessionId])
        .filter((record): record is SessionRecord => Boolean(record))
        .filter((record) => (targetWorkspaceId ? record.session.workspaceId === targetWorkspaceId : true))
        .map((record) => record.session);
    },

    setSessions: (sessions) => {
      const previousById = get().sessionsById;
      const nextById: Record<string, SessionRecord> = {};

      for (const session of sessions) {
        const previous = previousById[session.id];
        if (previous) {
          nextById[session.id] = syncRecordSession({
            ...previous,
            session: {
              ...previous.session,
              ...session,
            },
          });
        } else {
          nextById[session.id] = createSessionRecord(session);
        }
      }

      set({
        sessionsById: nextById,
        sessionOrder: sessions.map((session) => session.id),
      });
    },

    upsertSession: (session) => {
      const state = get();
      const existing = state.sessionsById[session.id];
      const nextRecord = existing
        ? syncRecordSession({
            ...existing,
            session: {
              ...existing.session,
              ...session,
            },
          })
        : createSessionRecord(session);

      set({
        sessionsById: {
          ...state.sessionsById,
          [session.id]: nextRecord,
        },
        sessionOrder: state.sessionOrder.includes(session.id)
          ? state.sessionOrder
          : [...state.sessionOrder, session.id],
      });
    },

    deleteSession: (sessionId) => {
      const state = get();
      if (!(sessionId in state.sessionsById)) {
        return;
      }

      const sessionsById = { ...state.sessionsById };
      delete sessionsById[sessionId];

      set({
        sessionsById,
        sessionOrder: state.sessionOrder.filter((id) => id !== sessionId),
      });
    },

    setSessionDetail: (sessionId, detail) => {
      const state = get();
      const messages = (detail.messages ?? []).map((message) => ({ ...message })) as SessionMessage[];
      const existing = state.sessionsById[sessionId];

      const nextRecord: SessionRecord = syncRecordSession({
        session: {
          ...detail,
          messageCount: messages.length,
        },
        messages,
        permissionRequests: existing?.permissionRequests ?? [],
        credentialRequests: existing?.credentialRequests ?? [],
        streaming: null,
        sessionMetadata: existing?.sessionMetadata ?? { isFlagged: false },
      });

      set({
        sessionsById: {
          ...state.sessionsById,
          [sessionId]: nextRecord,
        },
        sessionOrder: state.sessionOrder.includes(sessionId)
          ? state.sessionOrder
          : [...state.sessionOrder, sessionId],
      });
    },

    appendMessage: (sessionId, message) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          record.messages.push(message as SessionMessage);
          return record;
        }),
      );
    },

    updateMessage: (sessionId, messageId, patch) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          const messageIndex = record.messages.findIndex((message) => message.id === messageId);
          if (messageIndex === -1) {
            return record;
          }

          record.messages[messageIndex] = {
            ...record.messages[messageIndex],
            ...patch,
          } as SessionMessage;

          return record;
        }),
      );
    },

    removeMessage: (sessionId, messageId) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          record.messages = record.messages.filter((message) => message.id !== messageId);
          return record;
        }),
      );
    },

    enqueuePermissionRequest: (sessionId, request) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          if (!record.permissionRequests.some((queued) => queued.requestId === request.requestId)) {
            record.permissionRequests.push(request);
          }
          return record;
        }),
      );
    },

    dequeuePermissionRequest: (sessionId, requestId) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          record.permissionRequests = record.permissionRequests.filter(
            (request) => request.requestId !== requestId,
          );
          return record;
        }),
      );
    },

    enqueueCredentialRequest: (sessionId, request) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          if (!record.credentialRequests.some((queued) => queued.requestId === request.requestId)) {
            record.credentialRequests.push(request);
          }
          return record;
        }),
      );
    },

    dequeueCredentialRequest: (sessionId, requestId) => {
      set((state) =>
        mutateRecord(state, sessionId, (record) => {
          record.credentialRequests = record.credentialRequests.filter(
            (request) => request.requestId !== requestId,
          );
          return record;
        }),
      );
    },

    applyEvent: (event) => {
      set((state) => processSessionEvent(state, event));
    },

    reset: () => {
      set(createEmptySessionsSnapshot());
    },
  }));
}

export const sessionsStore = createSessionsStore();

export function useSessionsStore<T>(selector: (state: SessionsStoreState) => T): T {
  return useStore(sessionsStore, selector);
}
