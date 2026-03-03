/**
 * ChatTabBar - Row 2 of the chat header
 *
 * Horizontal tab bar: chat tab (always first, non-closeable) + file/turn tabs.
 * Active tab has an orange underline.
 */

import * as React from 'react'
import { Globe, MessageSquare, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import type { Tab } from '@/hooks/useChatTabs'
import { getFileTypeIcon } from '../right-sidebar/file-type-icons'
import { BrowserTabStrip } from '@/components/browser/BrowserTabStrip'

const STOPLIGHT_PADDING = 84

export interface ChatTabBarProps {
  tabs: Tab[]
  activeTabId: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  activeSessionId?: string
}

function getTabIcon(tab: Tab) {
  switch (tab.kind) {
    case 'chat':
      return <MessageSquare className="h-3.5 w-3.5" />
    case 'file':
      return getFileTypeIcon(tab.label, 'file')
    case 'turn':
      return <Sparkles className="h-3.5 w-3.5" />
    case 'workflow':
      return <Sparkles className="h-3.5 w-3.5" />
  }
}

export function ChatTabBar({ tabs, activeTabId, onActivate, onClose, activeSessionId }: ChatTabBarProps) {
  const shouldCompensate = useCompensateForStoplight()
  const [isOpeningBrowser, setIsOpeningBrowser] = React.useState(false)

  const handleFocusOrOpenBrowser = React.useCallback(async () => {
    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || isOpeningBrowser) return

    setIsOpeningBrowser(true)
    try {
      const instances = await browserPaneApi.list()
      const preferred = activeSessionId
        ? instances.find((item) => item.boundSessionId === activeSessionId)
        : null
      const fallback = instances[0]
      const target = preferred ?? fallback

      if (target) {
        await browserPaneApi.focus(target.id)
        return
      }

      await browserPaneApi.create({
        show: true,
        ...(activeSessionId ? { bindToSessionId: activeSessionId } : {}),
      })
    } catch (error) {
      console.warn('[ChatTabBar] Failed to focus/open browser pane:', error)
    } finally {
      setIsOpeningBrowser(false)
    }
  }, [activeSessionId, isOpeningBrowser])

  return (
    <div
      className={cn(
        'flex shrink-0 items-end gap-1 h-[36px] overflow-hidden',
        'titlebar-no-drag relative z-panel border-b border-border/30',
      )}
      style={{ paddingLeft: shouldCompensate ? STOPLIGHT_PADDING : 16 }}
    >
      <div className="flex min-w-0 flex-1 items-end gap-0 overflow-x-auto overflow-y-hidden">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isChat = tab.kind === 'chat'

          return (
            <button
              key={tab.id}
              onClick={() => onActivate(tab.id)}
              className={cn(
                'group relative flex items-center gap-1.5 h-[34px] text-[13px] shrink-0',
                tab.id === tabs[0]?.id ? 'pl-0 pr-3' : 'px-3',
                'transition-colors select-none outline-none',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground/70',
              )}
            >
              {/* Tab icon */}
              <span className="shrink-0 opacity-60">
                {getTabIcon(tab)}
              </span>

              {/* Tab label */}
              <span className="truncate max-w-[160px]">
                {tab.label}
              </span>

              {/* Close button (not on chat tab) */}
              {!isChat && (
                <span
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(tab.id)
                  }}
                  className={cn(
                    'shrink-0 ml-0.5 p-0.5 rounded-sm',
                    'opacity-0 group-hover:opacity-60 hover:!opacity-100',
                    'hover:bg-foreground/10 transition-all',
                  )}
                >
                  <X className="h-3 w-3" />
                </span>
              )}

              {/* Active indicator */}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-black/80 rounded-full" />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex h-[34px] items-center gap-1 pb-0.5 pr-2 shrink-0">
        <button
          type="button"
          onClick={handleFocusOrOpenBrowser}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          title="Open browser tab"
          aria-label="Open browser tab"
        >
          <Globe className="h-3.5 w-3.5" />
        </button>
        <BrowserTabStrip activeSessionId={activeSessionId} maxVisibleBadges={3} />
      </div>
    </div>
  )
}
