import { app } from 'electron'
import type {
  CredentialResponseDTO,
  CreateSessionOptionsDTO,
  PermissionResponseOptionsDTO,
  PermissionModeDTO,
  SendMessageOptionsDTO,
  SessionStatusDTO,
  WorkspaceDTO,
} from '@craft-agent/mobile-contracts'
import {
  createRuntimeGatewayServer,
  serializeSessionEvent,
  type GatewayMessageLike,
  type GatewaySessionEventLike,
  type GatewaySessionLike,
  type RuntimeSendMessageResult,
  type RuntimeSessionManager,
} from '@craft-agent/mobile-gateway'

import type { CreateSessionOptions, Message, SendMessageOptions, Session } from '../shared/types'
import { mainLog } from './logger'
import type { SessionManager } from './sessions'

const DEFAULT_MOBILE_GATEWAY_HOST = '0.0.0.0'
const DEFAULT_MOBILE_GATEWAY_PORT = 7842
const DEFAULT_SEND_ACCEPTED_STATUS = 202

function parseGatewayPort(rawPort: string | undefined): number {
  if (!rawPort) {
    return DEFAULT_MOBILE_GATEWAY_PORT
  }

  const parsed = Number.parseInt(rawPort, 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_MOBILE_GATEWAY_PORT
  }

  return parsed
}

function toWorkspaceDTO(workspace: { id: string; name: string }): WorkspaceDTO {
  return {
    id: workspace.id,
    name: workspace.name,
  }
}

function toGatewayMessage(message: Message): GatewayMessageLike {
  const toolInput = message.toolInput && typeof message.toolInput === 'object' && !Array.isArray(message.toolInput)
    ? message.toolInput
    : null

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    toolName: message.toolName ?? null,
    toolUseId: message.toolUseId ?? null,
    toolInput,
    toolResult: message.toolResult ?? null,
    toolStatus: message.toolStatus ?? null,
    isStreaming: message.isStreaming ?? false,
    isPending: message.isPending ?? false,
    isIntermediate: message.isIntermediate ?? false,
  }
}

function toGatewaySession(session: Session): GatewaySessionLike {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    name: session.name ?? null,
    workingDirectory: session.workingDirectory,
    lastMessageAt: session.lastMessageAt,
    isProcessing: session.isProcessing,
    sessionStatus: session.sessionStatus ?? null,
    hasUnread: session.hasUnread ?? false,
    permissionMode: (session.permissionMode as PermissionModeDTO | undefined) ?? null,
    labels: session.labels ?? [],
    preview: session.preview ?? null,
    messageCount: session.messageCount ?? session.messages.length,
    tokenUsage: session.tokenUsage ?? null,
    messages: session.messages.map(toGatewayMessage),
  }
}

function toCreateSessionOptions(options: CreateSessionOptionsDTO): CreateSessionOptions {
  const createSessionOptions: CreateSessionOptions = {}

  if (typeof options.name === 'string') {
    createSessionOptions.name = options.name
  }

  if (typeof options.permissionMode === 'string') {
    createSessionOptions.permissionMode = options.permissionMode
  }

  if (typeof options.workingDirectory === 'string') {
    createSessionOptions.workingDirectory = options.workingDirectory
  }

  return createSessionOptions
}

function toSendMessageOptions(options: SendMessageOptionsDTO): SendMessageOptions {
  const sendMessageOptions: SendMessageOptions = {}

  if (typeof options.optimisticMessageId === 'string') {
    sendMessageOptions.optimisticMessageId = options.optimisticMessageId
  }

  if (typeof options.ultrathinkEnabled === 'boolean') {
    sendMessageOptions.ultrathinkEnabled = options.ultrathinkEnabled
  }

  if (Array.isArray(options.skillSlugs)) {
    sendMessageOptions.skillSlugs = options.skillSlugs
  }

  return sendMessageOptions
}

function createSessionManagerAdapter(sessionManager: SessionManager): RuntimeSessionManager {
  return {
    async getWorkspaces() {
      return sessionManager.getWorkspaces().map(toWorkspaceDTO)
    },
    async getSessions(workspaceId: string) {
      return sessionManager.getSessions(workspaceId).map(toGatewaySession)
    },
    async getSession(sessionId: string) {
      const session = await sessionManager.getSession(sessionId)
      return session ? toGatewaySession(session) : null
    },
    async createSession(workspaceId: string, options: CreateSessionOptionsDTO) {
      const createdSession = await sessionManager.createSession(workspaceId, toCreateSessionOptions(options))
      return toGatewaySession(createdSession)
    },
    async sendMessage(sessionId: string, text: string, options: SendMessageOptionsDTO): Promise<RuntimeSendMessageResult> {
      const sendMessageOptions = toSendMessageOptions(options)

      void sessionManager.sendMessage(
        sessionId,
        text,
        undefined,
        undefined,
        sendMessageOptions,
      ).catch((error) => {
        mainLog.error(`[mobile-gateway] Failed to send message for session ${sessionId}:`, error)
      })

      return {
        status: DEFAULT_SEND_ACCEPTED_STATUS,
        events: [],
      }
    },
    async renameSession(sessionId: string, name: string) {
      await sessionManager.renameSession(sessionId, name)
    },
    async setSessionStatus(sessionId: string, state: SessionStatusDTO) {
      await sessionManager.setSessionStatus(sessionId, state)
    },
    async markSessionRead(sessionId: string) {
      await sessionManager.markSessionRead(sessionId)
    },
    async markSessionUnread(sessionId: string) {
      await sessionManager.markSessionUnread(sessionId)
    },
    async setSessionPermissionMode(sessionId: string, mode: PermissionModeDTO) {
      sessionManager.setSessionPermissionMode(sessionId, mode)
    },
    async respondToPermission(
      sessionId: string,
      requestId: string,
      allowed: boolean,
      alwaysAllow: boolean,
      options?: PermissionResponseOptionsDTO
    ) {
      return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow, options)
    },
    async respondToCredential(sessionId: string, requestId: string, response: CredentialResponseDTO) {
      return sessionManager.respondToCredential(sessionId, requestId, response)
    },
    async cancelProcessing(sessionId: string) {
      const session = await sessionManager.getSession(sessionId)
      if (!session?.isProcessing) {
        return false
      }

      await sessionManager.cancelProcessing(sessionId)
      return true
    },
    async killShell(sessionId: string, shellId: string) {
      const result = await sessionManager.killShell(sessionId, shellId)
      return result.success
    },
    async deleteSession(sessionId: string) {
      const session = await sessionManager.getSession(sessionId)
      if (!session) {
        return false
      }

      await sessionManager.deleteSession(sessionId)
      return true
    },
  }
}

export interface MobileGatewayController {
  start: () => Promise<void>
  stop: () => Promise<void>
}

export function createMobileGatewayController(sessionManager: SessionManager): MobileGatewayController {
  const host = process.env.CRAFT_MOBILE_GATEWAY_HOST?.trim() || DEFAULT_MOBILE_GATEWAY_HOST
  const port = parseGatewayPort(process.env.CRAFT_MOBILE_GATEWAY_PORT)
  const adapter = createSessionManagerAdapter(sessionManager)

  const gatewayServer = createRuntimeGatewayServer({
    host,
    port,
    version: app.getVersion(),
    sessionManager: adapter,
  })

  let started = false
  let unsubscribeSessionEvents: (() => void) | null = null

  return {
    async start() {
      if (started) {
        return
      }

      unsubscribeSessionEvents = sessionManager.addEventListener((event) => {
        const serializedEvent = serializeSessionEvent(event as GatewaySessionEventLike)
        if (serializedEvent) {
          gatewayServer.broadcast(serializedEvent)
        }
      })

      try {
        const address = await gatewayServer.start()
        started = true
        mainLog.info(`[mobile-gateway] Listening on http://${address.host}:${address.port}`)
      } catch (error) {
        unsubscribeSessionEvents?.()
        unsubscribeSessionEvents = null
        throw error
      }
    },

    async stop() {
      if (!started) {
        unsubscribeSessionEvents?.()
        unsubscribeSessionEvents = null
        return
      }

      unsubscribeSessionEvents?.()
      unsubscribeSessionEvents = null

      await gatewayServer.stop()
      started = false
      mainLog.info('[mobile-gateway] Stopped')
    },
  }
}
