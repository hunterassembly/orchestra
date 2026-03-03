/**
 * ChatTabBar - Row 2 of the chat header
 *
 * Horizontal tab bar: chat tab (always first, non-closeable) + file/turn tabs.
 * Active tab has an orange underline.
 */

import * as React from 'react'
import { MessageSquare, Sparkles, X } from 'lucide-react'
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
  }
}

export function ChatTabBar({ tabs, activeTabId, onActivate, onClose, activeSessionId }: ChatTabBarProps) {
  const shouldCompensate = useCompensateForStoplight()

  return (
    <div
      className={cn(
        'flex shrink-0 items-end gap-1 h-[36px] overflow-hidden',
        'titlebar-no-drag relative z-panel border-b border-border/30',
      )}
      style={{ paddingLeft: shouldCompensate ? STOPLIGHT_PADDING : 12 }}
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
                'group relative flex items-center gap-1.5 px-3 h-[34px] text-[12px] shrink-0',
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

              {/* Active indicator — orange underline */}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-orange-400 rounded-full" />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex h-[34px] items-center pb-0.5 pr-2 shrink-0">
        <BrowserTabStrip activeSessionId={activeSessionId} maxVisibleBadges={3} />
      </div>
    </div>
  )
}
