/**
 * useChatTabs - Tab state management for the chat panel
 *
 * Manages a list of tabs where the chat is always the first (non-closeable) tab.
 * File previews and turn expansions open as additional closeable tabs.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { FilePreviewState } from './useLinkInterceptor'
import type { ChatOverlayState } from '@/components/app-shell/ChatDisplay'

// ============================================================
// Tab Types
// ============================================================

export interface ChatTab {
  id: 'chat'
  kind: 'chat'
  label: string
}

export interface FileTab {
  id: string
  kind: 'file'
  label: string
  filePath: string
  previewState: FilePreviewState
}

export interface TurnTab {
  id: string
  kind: 'turn'
  label: string
  overlayState: ChatOverlayState
}

export type Tab = ChatTab | FileTab | TurnTab

// ============================================================
// Hook
// ============================================================

let tabIdCounter = 0

export function useChatTabs(sessionId: string, chatLabel: string) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'chat', kind: 'chat', label: chatLabel },
  ])
  const [activeTabId, setActiveTabId] = useState<string>('chat')
  const prevSessionIdRef = useRef(sessionId)

  // Keep chat tab label in sync
  useEffect(() => {
    setTabs((prev) =>
      prev.map((t) => (t.id === 'chat' ? { ...t, label: chatLabel } : t)),
    )
  }, [chatLabel])

  // Reset to chat-only when session changes
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      setTabs([{ id: 'chat', kind: 'chat', label: chatLabel }])
      setActiveTabId('chat')
    }
  }, [sessionId, chatLabel])

  const activateTab = useCallback((id: string) => {
    setActiveTabId(id)
  }, [])

  const openFileTab = useCallback((previewState: FilePreviewState) => {
    const filePath = previewState.filePath
    const label = filePath.split('/').pop() || filePath

    setTabs((prev) => {
      // Dedupe by filePath
      const existing = prev.find(
        (t) => t.kind === 'file' && t.filePath === filePath,
      ) as FileTab | undefined
      if (existing) {
        setActiveTabId(existing.id)
        return prev
      }

      const id = `file-${++tabIdCounter}`
      const newTab: FileTab = { id, kind: 'file', label, filePath, previewState }
      setActiveTabId(id)
      return [...prev, newTab]
    })
  }, [])

  const openTurnTab = useCallback((overlayState: ChatOverlayState, label: string) => {
    const id = `turn-${++tabIdCounter}`
    const newTab: TurnTab = { id, kind: 'turn', label, overlayState }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback((id: string) => {
    if (id === 'chat') return // Can't close chat tab

    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return prev

      const next = prev.filter((t) => t.id !== id)

      // If closing the active tab, switch to adjacent
      setActiveTabId((currentActive) => {
        if (currentActive !== id) return currentActive
        // Prefer left neighbor, then right, fallback to chat
        const newIdx = Math.min(idx, next.length - 1)
        return next[newIdx]?.id ?? 'chat'
      })

      return next
    })
  }, [])

  const isChatActive = activeTabId === 'chat'
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  return {
    tabs,
    activeTabId,
    activeTab,
    isChatActive,
    activateTab,
    openFileTab,
    openTurnTab,
    closeTab,
  }
}
