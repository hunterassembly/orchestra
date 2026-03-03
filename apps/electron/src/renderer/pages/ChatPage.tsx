/**
 * ChatPage
 *
 * Displays a single session's chat with a consistent PanelHeader.
 * Extracted from MainContentPanel for consistency with other pages.
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { AlertCircle } from 'lucide-react'
import { ChatDisplay, type ChatDisplayHandle, type ChatOverlayState } from '@/components/app-shell/ChatDisplay'
import { ChatMetadataBar } from '@/components/app-shell/ChatMetadataBar'
import { ChatTabBar } from '@/components/app-shell/ChatTabBar'
import { TabContentRenderer } from '@/components/app-shell/TabContentRenderer'
import { useChatTabs } from '@/hooks/useChatTabs'
import { classifyFile } from '@craft-agent/ui'
import { getLanguageFromPath } from '@/lib/file-utils'
import { SessionMenu } from '@/components/app-shell/SessionMenu'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { toast } from 'sonner'
import { useAppShellContext, usePendingPermission, usePendingCredential, useSessionOptionsFor, useSession as useSessionData } from '@/context/AppShellContext'
import { rendererPerf } from '@/lib/perf'
import { routes } from '@/lib/navigate'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { getSessionTitle } from '@/utils/session'
// Model resolution: connection.defaultModel (no hardcoded defaults)
import { resolveEffectiveConnectionSlug, isSessionConnectionUnavailable } from '@config/llm-connections'

export interface ChatPageProps {
  sessionId: string
}

const ChatPage = React.memo(function ChatPage({ sessionId }: ChatPageProps) {
  // Diagnostic: mark when component runs
  React.useLayoutEffect(() => {
    rendererPerf.markSessionSwitch(sessionId, 'panel.mounted')
  }, [sessionId])

  const {
    activeWorkspaceId,
    llmConnections,
    workspaceDefaultLlmConnection,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    onRespondToPermission,
    onRespondToCredential,
    onMarkSessionRead,
    onMarkSessionUnread,
    onSetActiveViewingSession,
    textareaRef,
    getDraft,
    onInputChange,
    enabledSources,
    skills,
    labels,
    onSessionLabelsChange,
    enabledModes,
    sessionStatuses,
    onSessionSourcesChange,
    onRenameSession,
    onFlagSession,
    onUnflagSession,
    onArchiveSession,
    onUnarchiveSession,
    onSessionStatusChange,
    onDeleteSession,
    rightSidebarButton,
    sessionListSearchQuery,
    isSearchModeActive,
    chatDisplayRef,
    openFileAsTabRef,
    openWorkflowTabRef,
    onChatMatchInfoChange,
  } = useAppShellContext()

  // Use the unified session options hook for clean access
  const {
    options: sessionOpts,
    setOption,
    setPermissionMode,
  } = useSessionOptionsFor(sessionId)

  // Use per-session atom for isolated updates
  const session = useSessionData(sessionId)

  // Track if messages are loaded for this session (for lazy loading)
  const loadedSessions = useAtomValue(loadedSessionsAtom)
  const messagesLoaded = loadedSessions.has(sessionId)

  // Check if session exists in metadata (for loading state detection)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = sessionMetaMap.get(sessionId)

  // Fallback: ensure messages are loaded when session is viewed
  const ensureMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  React.useEffect(() => {
    ensureMessagesLoaded(sessionId)
  }, [sessionId, ensureMessagesLoaded])

  // Perf: Mark when session data is available
  const sessionLoadedMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (session && sessionLoadedMarkedRef.current !== sessionId) {
      sessionLoadedMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'session.loaded')
    }
  }, [sessionId, session])

  // Track window focus state for marking session as read when app regains focus
  const [isWindowFocused, setIsWindowFocused] = React.useState(true)
  React.useEffect(() => {
    window.electronAPI.getWindowFocusState().then(setIsWindowFocused)
    const cleanup = window.electronAPI.onWindowFocusChange(setIsWindowFocused)
    return cleanup
  }, [])

  // Track which session user is viewing (for unread state machine).
  // This tells main process user is looking at this session, so:
  // 1. If not processing → clear hasUnread immediately
  // 2. If processing → when it completes, main process will clear hasUnread
  // The main process handles all the logic; we just report viewing state.
  React.useEffect(() => {
    if (session && isWindowFocused) {
      onSetActiveViewingSession(session.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, isWindowFocused, onSetActiveViewingSession])

  // Get pending permission and credential for this session
  const pendingPermission = usePendingPermission(sessionId)
  const pendingCredential = usePendingCredential(sessionId)

  // Track draft value for this session
  const [inputValue, setInputValue] = React.useState(() => getDraft(sessionId))
  const inputValueRef = React.useRef(inputValue)
  inputValueRef.current = inputValue

  // Re-sync from parent when session changes
  React.useEffect(() => {
    setInputValue(getDraft(sessionId))
  }, [getDraft, sessionId])

  // Sync when draft is set externally (e.g., from notifications or shortcuts)
  // PERFORMANCE NOTE: This bounded polling (max 10 attempts × 50ms = 500ms)
  // handles external draft injection. Drafts use a ref for typing performance,
  // so they're not directly reactive. This polling only runs on session switch,
  // not continuously. Alternative: Add a Jotai atom for draft changes.
  React.useEffect(() => {
    let attempts = 0
    const maxAttempts = 10
    const interval = setInterval(() => {
      const currentDraft = getDraft(sessionId)
      if (currentDraft !== inputValueRef.current && currentDraft !== '') {
        setInputValue(currentDraft)
        clearInterval(interval)
      }
      attempts++
      if (attempts >= maxAttempts) {
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [sessionId, getDraft])

  // Listen for restore-input events (queued messages restored to input on abort)
  React.useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId: targetId, text } = (e as CustomEvent).detail
      if (targetId === sessionId) {
        setInputValue(text)
        inputValueRef.current = text
      }
    }
    window.addEventListener('craft:restore-input', handler)
    return () => window.removeEventListener('craft:restore-input', handler)
  }, [sessionId])

  const handleInputChange = React.useCallback((value: string) => {
    setInputValue(value)
    inputValueRef.current = value
    onInputChange(sessionId, value)
  }, [sessionId, onInputChange])

  // Session model change handler - persists per-session model and connection
  const handleModelChange = React.useCallback((model: string, connection?: string) => {
    if (activeWorkspaceId) {
      window.electronAPI.setSessionModel(sessionId, activeWorkspaceId, model, connection)
    }
  }, [sessionId, activeWorkspaceId])

  // Session connection change handler - can only change before first message
  const handleConnectionChange = React.useCallback(async (connectionSlug: string) => {
    try {
      await window.electronAPI.sessionCommand(sessionId, { type: 'setConnection', connectionSlug })
    } catch (error) {
      // Connection change may fail if session already started or connection is invalid
      console.error('Failed to change connection:', error)
    }
  }, [sessionId])

  // Check if session's locked connection has been removed
  const connectionUnavailable = React.useMemo(() =>
    isSessionConnectionUnavailable(session?.llmConnection, llmConnections),
    [session?.llmConnection, llmConnections]
  )

  // Effective model for this session (session-specific or global fallback)
  const effectiveModel = React.useMemo(() => {
    if (session?.model) return session.model

    // When connection is unavailable, don't resolve through a different connection
    if (connectionUnavailable) return session?.model ?? ''

    const connectionSlug = resolveEffectiveConnectionSlug(
      session?.llmConnection, workspaceDefaultLlmConnection, llmConnections
    )
    const connection = connectionSlug ? llmConnections.find(c => c.slug === connectionSlug) : null

    return connection?.defaultModel ?? ''
  }, [session?.id, session?.model, session?.llmConnection, workspaceDefaultLlmConnection, llmConnections, connectionUnavailable])

  const effectiveConnectionSlug = React.useMemo(() => {
    if (connectionUnavailable) return session?.llmConnection ?? null
    return resolveEffectiveConnectionSlug(
      session?.llmConnection,
      workspaceDefaultLlmConnection,
      llmConnections
    ) ?? null
  }, [session?.llmConnection, workspaceDefaultLlmConnection, llmConnections, connectionUnavailable])

  const isCodexLikeConnection = React.useMemo(() => {
    const slug = (effectiveConnectionSlug ?? '').toLowerCase()
    const model = (effectiveModel ?? '').toLowerCase()
    return slug.includes('codex')
      || slug.includes('chatgpt')
      || model.includes('gpt-')
      || model.includes('codex')
  }, [effectiveConnectionSlug, effectiveModel])

  // Working directory for this session
  const workingDirectory = session?.workingDirectory
  const handleWorkingDirectoryChange = React.useCallback(async (path: string) => {
    if (!session) return
    await window.electronAPI.sessionCommand(session.id, { type: 'updateWorkingDirectory', dir: path })
  }, [session])

  const handleOpenUrl = React.useCallback(
    (url: string) => {
      onOpenUrl(url)
    },
    [onOpenUrl]
  )

  // Get display title early — needed by useChatTabs
  const displayTitle = session ? getSessionTitle(session) : (sessionMeta ? getSessionTitle(sessionMeta) : 'Session')

  // Tab system
  const chatTabs = useChatTabs(sessionId, displayTitle)

  // File open → create tab (instead of going to useLinkInterceptor overlay)
  const handleOpenFileAsTab = React.useCallback(
    async (path: string) => {
      // Resolve relative paths
      const resolved = (path.startsWith('/') || path.startsWith('~/'))
        ? path
        : workingDirectory
          ? `${workingDirectory}/${path}`
          : path

      const classification = classifyFile(resolved)

      if (!classification.canPreview || !classification.type) {
        // Not previewable — open externally
        window.electronAPI.openFile(resolved)
        return
      }

      const type = classification.type

      // Image/PDF — set state immediately, overlay handles loading
      if (type === 'image') {
        chatTabs.openFileTab({ type: 'image', filePath: resolved })
        return
      }
      if (type === 'pdf') {
        chatTabs.openFileTab({ type: 'pdf', filePath: resolved })
        return
      }

      // Text-based files — read content first
      try {
        const content = await window.electronAPI.readFile(resolved)
        if (type === 'code') {
          chatTabs.openFileTab({ type: 'code', filePath: resolved, content, language: getLanguageFromPath(resolved) })
        } else if (type === 'markdown') {
          chatTabs.openFileTab({ type: 'markdown', filePath: resolved, content })
        } else if (type === 'json') {
          chatTabs.openFileTab({ type: 'json', filePath: resolved, content })
        } else {
          chatTabs.openFileTab({ type: 'text', filePath: resolved, content })
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to read file'
        chatTabs.openFileTab({ type: 'text', filePath: resolved, content: '', error: errorMsg })
      }
    },
    [workingDirectory, chatTabs],
  )

  // Turn expansion → create tab (instead of overlay in ChatDisplay)
  const handleOpenTurnAsTab = React.useCallback(
    (overlay: ChatOverlayState, label: string) => {
      chatTabs.openTurnTab(overlay, label)
    },
    [chatTabs],
  )

  const handleOpenWorkflowTab = React.useCallback((workflow: { label: string; prompt: string; autoSend?: boolean }) => {
    chatTabs.openWorkflowTab({ label: workflow.label, prompt: workflow.prompt })
    if (workflow.autoSend !== false && session) {
      onSendMessage(session.id, workflow.prompt)
    }
  }, [chatTabs, session, onSendMessage])

  const handleSelectBranchFromHeader = React.useCallback(async (branch: string) => {
    if (!workingDirectory) {
      toast.error('No working directory', { description: 'Cannot switch branches without a working directory.' })
      return
    }

    try {
      const result = await window.electronAPI.switchGitBranch(workingDirectory, branch)
      if (!result.success) {
        toast.error('Failed to switch branch', { description: result.error ?? 'Unknown git error' })
        return
      }

      toast.success('Branch switched', { description: `Now on ${result.branch ?? branch}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown git error'
      toast.error('Failed to switch branch', { description: message })
    }
  }, [workingDirectory])

  // Register tab handler so sidebar can open files as tabs
  React.useEffect(() => {
    if (openFileAsTabRef) {
      openFileAsTabRef.current = handleOpenFileAsTab
      return () => { openFileAsTabRef.current = null }
    }
  }, [openFileAsTabRef, handleOpenFileAsTab])

  React.useEffect(() => {
    if (openWorkflowTabRef) {
      openWorkflowTabRef.current = handleOpenWorkflowTab
      return () => { openWorkflowTabRef.current = null }
    }
  }, [openWorkflowTabRef, handleOpenWorkflowTab])

  // Perf: Mark when data is ready
  const dataReadyMarkedRef = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (messagesLoaded && session && dataReadyMarkedRef.current !== sessionId) {
      dataReadyMarkedRef.current = sessionId
      rendererPerf.markSessionSwitch(sessionId, 'data.ready')
    }
  }, [sessionId, messagesLoaded, session])

  // Perf: Mark render complete after paint
  React.useEffect(() => {
    if (session) {
      const rafId = requestAnimationFrame(() => {
        rendererPerf.endSessionSwitch(sessionId)
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [sessionId, session])

  const isFlagged = session?.isFlagged || sessionMeta?.isFlagged || false
  const isArchived = session?.isArchived || sessionMeta?.isArchived || false
  const currentSessionStatus = session?.sessionStatus || sessionMeta?.sessionStatus || 'todo'
  const hasMessages = !!(session?.messages?.length || sessionMeta?.lastFinalMessageId)
  const hasUnreadMessages = sessionMeta
    ? !!(sessionMeta.lastFinalMessageId && sessionMeta.lastFinalMessageId !== sessionMeta.lastReadMessageId)
    : false
  // Use isAsyncOperationOngoing for shimmer effect (sharing, updating share, revoking, title regeneration)
  const isAsyncOperationOngoing = session?.isAsyncOperationOngoing || sessionMeta?.isAsyncOperationOngoing || false

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false)
  const [renameName, setRenameName] = React.useState('')

  // Session action handlers
  const handleRename = React.useCallback(() => {
    setRenameName(displayTitle)
    setRenameDialogOpen(true)
  }, [displayTitle])

  const handleRenameSubmit = React.useCallback(() => {
    if (renameName.trim() && renameName.trim() !== displayTitle) {
      onRenameSession(sessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
  }, [sessionId, renameName, displayTitle, onRenameSession])

  const handleFlag = React.useCallback(() => {
    onFlagSession(sessionId)
  }, [sessionId, onFlagSession])

  const handleUnflag = React.useCallback(() => {
    onUnflagSession(sessionId)
  }, [sessionId, onUnflagSession])

  const handleArchive = React.useCallback(() => {
    onArchiveSession(sessionId)
  }, [sessionId, onArchiveSession])

  const handleUnarchive = React.useCallback(() => {
    onUnarchiveSession(sessionId)
  }, [sessionId, onUnarchiveSession])

  const handleMarkUnread = React.useCallback(() => {
    onMarkSessionUnread(sessionId)
  }, [sessionId, onMarkSessionUnread])

  const handleSessionStatusChange = React.useCallback((state: string) => {
    onSessionStatusChange(sessionId, state)
  }, [sessionId, onSessionStatusChange])

  const handleLabelsChange = React.useCallback((newLabels: string[]) => {
    onSessionLabelsChange?.(sessionId, newLabels)
  }, [sessionId, onSessionLabelsChange])

  const handleDelete = React.useCallback(async () => {
    await onDeleteSession(sessionId)
  }, [sessionId, onDeleteSession])

  const handleOpenInNewWindow = React.useCallback(async () => {
    const route = routes.view.allSessions(sessionId)
    const separator = route.includes('?') ? '&' : '?'
    const url = `orchestra://${route}${separator}window=focused`
    try {
      await window.electronAPI?.openUrl(url)
    } catch (error) {
      console.error('[ChatPage] openUrl failed:', error)
    }
  }, [sessionId])

  // Build title menu content for chat sessions using shared SessionMenu
  const titleMenu = React.useMemo(() => sessionMeta ? (
    <SessionMenu
      item={sessionMeta}
      sessionStatuses={sessionStatuses ?? []}
      labels={labels ?? []}
      onLabelsChange={handleLabelsChange}
      onRename={handleRename}
      onFlag={handleFlag}
      onUnflag={handleUnflag}
      onArchive={handleArchive}
      onUnarchive={handleUnarchive}
      onMarkUnread={handleMarkUnread}
      onSessionStatusChange={handleSessionStatusChange}
      onOpenInNewWindow={handleOpenInNewWindow}
      onDelete={handleDelete}
    />
  ) : null, [
    sessionMeta,
    sessionStatuses,
    labels,
    handleLabelsChange,
    handleRename,
    handleFlag,
    handleUnflag,
    handleArchive,
    handleUnarchive,
    handleMarkUnread,
    handleSessionStatusChange,
    handleOpenInNewWindow,
    handleDelete,
  ])

  // Handle missing session - loading or deleted
  if (!session) {
    if (sessionMeta) {
      // Session exists in metadata but not loaded yet - show loading state
      const skeletonSession = {
        id: sessionMeta.id,
        workspaceId: sessionMeta.workspaceId,
        workspaceName: '',
        name: sessionMeta.name,
        preview: sessionMeta.preview,
        lastMessageAt: sessionMeta.lastMessageAt || 0,
        messages: [],
        isProcessing: sessionMeta.isProcessing || false,
        isFlagged: sessionMeta.isFlagged,
        workingDirectory: sessionMeta.workingDirectory,
        enabledSourceSlugs: sessionMeta.enabledSourceSlugs,
      }

      return (
        <>
          <div className="h-full flex flex-col">
            <ChatMetadataBar
              workingDirectory={sessionMeta.workingDirectory}
              contextTokens={sessionMeta.tokenUsage?.inputTokens}
              showContextTokens={isCodexLikeConnection}
              rightSidebarButton={rightSidebarButton}
              onSelectBranch={handleSelectBranchFromHeader}
            />
            <ChatTabBar
              tabs={chatTabs.tabs}
              activeTabId={chatTabs.activeTabId}
              onActivate={chatTabs.activateTab}
              onClose={chatTabs.closeTab}
              activeSessionId={sessionId}
            />
            <div className="flex-1 flex flex-col min-h-0">
              <ChatDisplay
                ref={chatDisplayRef}
                session={skeletonSession}
                onSendMessage={() => {}}
                onOpenFile={handleOpenFileAsTab}
                onOpenUrl={handleOpenUrl}
                onOpenTurnAsTab={handleOpenTurnAsTab}
                currentModel={effectiveModel}
                onModelChange={handleModelChange}
                onConnectionChange={handleConnectionChange}
                textareaRef={textareaRef}
                pendingPermission={undefined}
                onRespondToPermission={onRespondToPermission}
                pendingCredential={undefined}
                onRespondToCredential={onRespondToCredential}
                thinkingLevel={sessionOpts.thinkingLevel}
                onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
                ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
                onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
                permissionMode={sessionOpts.permissionMode}
                onPermissionModeChange={setPermissionMode}
                enabledModes={enabledModes}
                inputValue={inputValue}
                onInputChange={handleInputChange}
                sources={enabledSources}
                skills={skills}
                sessionStatuses={sessionStatuses}
                onSessionStatusChange={handleSessionStatusChange}
                workspaceId={activeWorkspaceId || undefined}
                onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
                workingDirectory={sessionMeta.workingDirectory}
                onWorkingDirectoryChange={handleWorkingDirectoryChange}
                messagesLoading={true}
                searchQuery={sessionListSearchQuery}
                isSearchModeActive={isSearchModeActive}
                onMatchInfoChange={onChatMatchInfoChange}
                connectionUnavailable={connectionUnavailable}
              />
            </div>
          </div>
          <RenameDialog
            open={renameDialogOpen}
            onOpenChange={setRenameDialogOpen}
            title="Rename Session"
            value={renameName}
            onValueChange={setRenameName}
            onSubmit={handleRenameSubmit}
            placeholder="Enter session name..."
          />
        </>
      )
    }

    // Session truly doesn't exist
    return (
      <div className="h-full flex flex-col">
        <ChatMetadataBar rightSidebarButton={rightSidebarButton} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">This session no longer exists</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Row 1: metadata bar (branch, folder, cost) */}
        <ChatMetadataBar
          workingDirectory={workingDirectory}
          costUsd={session.tokenUsage?.costUsd}
          contextTokens={session.tokenUsage?.inputTokens}
          showContextTokens={isCodexLikeConnection}
          rightSidebarButton={rightSidebarButton}
          onSelectBranch={handleSelectBranchFromHeader}
        />
        {/* Row 2: tab bar */}
        <ChatTabBar
          tabs={chatTabs.tabs}
          activeTabId={chatTabs.activeTabId}
          onActivate={chatTabs.activateTab}
          onClose={chatTabs.closeTab}
          activeSessionId={sessionId}
        />
        {/* Content area */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Chat — stays mounted via display toggle */}
          <div
            className="flex-1 flex flex-col min-h-0"
            style={{ display: chatTabs.isChatActive ? 'flex' : 'none' }}
          >
            <ChatDisplay
              ref={chatDisplayRef}
              session={session}
              onSendMessage={(message, attachments, skillSlugs) => {
                if (session) {
                  onSendMessage(session.id, message, attachments, skillSlugs)
                }
              }}
              onOpenFile={handleOpenFileAsTab}
              onOpenUrl={handleOpenUrl}
              onOpenTurnAsTab={handleOpenTurnAsTab}
              currentModel={effectiveModel}
              onModelChange={handleModelChange}
              onConnectionChange={handleConnectionChange}
              textareaRef={textareaRef}
              pendingPermission={pendingPermission}
              onRespondToPermission={onRespondToPermission}
              pendingCredential={pendingCredential}
              onRespondToCredential={onRespondToCredential}
              thinkingLevel={sessionOpts.thinkingLevel}
              onThinkingLevelChange={(level) => setOption('thinkingLevel', level)}
              ultrathinkEnabled={sessionOpts.ultrathinkEnabled}
              onUltrathinkChange={(enabled) => setOption('ultrathinkEnabled', enabled)}
              permissionMode={sessionOpts.permissionMode}
              onPermissionModeChange={setPermissionMode}
              enabledModes={enabledModes}
              inputValue={inputValue}
              onInputChange={handleInputChange}
              sources={enabledSources}
              skills={skills}
              labels={labels}
              onLabelsChange={(newLabels) => onSessionLabelsChange?.(sessionId, newLabels)}
              sessionStatuses={sessionStatuses}
              onSessionStatusChange={handleSessionStatusChange}
              workspaceId={activeWorkspaceId || undefined}
              onSourcesChange={(slugs) => onSessionSourcesChange?.(sessionId, slugs)}
              workingDirectory={workingDirectory}
              onWorkingDirectoryChange={handleWorkingDirectoryChange}
              sessionFolderPath={session?.sessionFolderPath}
              messagesLoading={!messagesLoaded}
              searchQuery={sessionListSearchQuery}
              isSearchModeActive={isSearchModeActive}
              onMatchInfoChange={onChatMatchInfoChange}
              connectionUnavailable={connectionUnavailable}
            />
          </div>
          {/* Non-chat tab content */}
          {!chatTabs.isChatActive && chatTabs.activeTab && (
            <TabContentRenderer
              tab={chatTabs.activeTab}
              onClose={() => chatTabs.closeTab(chatTabs.activeTabId)}
              readFileDataUrl={(path) => window.electronAPI.readFileDataUrl(path)}
              readFileBinary={(path) => window.electronAPI.readFileBinary(path)}
              onOpenFile={handleOpenFileAsTab}
              onOpenUrl={handleOpenUrl}
            />
          )}
        </div>
      </div>
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title="Rename Session"
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder="Enter session name..."
      />
    </>
  )
})

export default ChatPage
