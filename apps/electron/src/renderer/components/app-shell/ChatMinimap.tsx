/**
 * ChatMinimap - Vertical scrubber on the right edge of chat
 *
 * Collapsed: thin strip with 20px-wide horizontal bars (4px tall).
 *   - User messages: warm copper color
 *   - Assistant messages: light gray
 *   - Current viewport message: dark/black
 *
 * Expanded (on hover): 2-pane popup (~420x340).
 *   - Left pane: summary of the highlighted/hovered message
 *   - Right pane: scrollable list of all messages with truncated text
 *   - Current message highlighted with amber background
 *   - Clicking scrolls to that message
 */

import * as React from 'react'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Image } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Turn } from '@craft-agent/ui'

// ============================================================
// Types
// ============================================================

interface ChatMinimapProps {
  turns: Turn[]
  scrollViewportRef: React.RefObject<HTMLDivElement>
  turnRefs: React.RefObject<Map<string, HTMLDivElement>>
  onScrollToTurn: (turnKey: string) => void
}

interface TurnInfo {
  turnKey: string
  type: 'user' | 'assistant' | 'system' | 'auth-request'
  text: string
  hasAttachments: boolean
}

function getTurnKey(turn: Turn): string {
  if (turn.type === 'user') return `user-${turn.message.id}`
  if (turn.type === 'system') return `system-${turn.message.id}`
  if (turn.type === 'auth-request') return `auth-${turn.message.id}`
  return `turn-${turn.turnId}-${turn.timestamp}`
}

function getTurnText(turn: Turn): string {
  if (turn.type === 'user') return turn.message.content || ''
  if (turn.type === 'system') return turn.message.content || ''
  if (turn.type === 'auth-request') return 'Authentication request'
  // Assistant turn — use intent or first bit of response
  return turn.intent || turn.response?.text?.slice(0, 200) || ''
}

// ============================================================
// ChatMinimap
// ============================================================

export function ChatMinimap({
  turns,
  scrollViewportRef,
  turnRefs,
  onScrollToTurn,
}: ChatMinimapProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [hoveredTurnKey, setHoveredTurnKey] = useState<string | null>(null)
  const [currentTurnKey, setCurrentTurnKey] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Extract all turns with metadata
  const turnInfos = useMemo(() => {
    const result: TurnInfo[] = []
    for (const turn of turns) {
      const text = getTurnText(turn)
      const hasAttachments =
        turn.type === 'user' && (turn.message.attachments?.length ?? 0) > 0

      result.push({
        turnKey: getTurnKey(turn),
        type: turn.type,
        text: text.slice(0, 200).trim(),
        hasAttachments,
      })
    }
    return result
  }, [turns])

  // Track which turn is currently visible in the viewport
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const updateCurrentTurn = () => {
      const refs = turnRefs.current
      if (!refs) return

      const viewportTop = viewport.scrollTop
      const viewportMiddle = viewportTop + viewport.clientHeight / 3

      let closestKey: string | null = null
      let closestDistance = Infinity

      for (const info of turnInfos) {
        const el = refs.get(info.turnKey)
        if (!el) continue

        const distance = Math.abs(el.offsetTop - viewportMiddle)
        if (distance < closestDistance) {
          closestDistance = distance
          closestKey = info.turnKey
        }
      }

      setCurrentTurnKey(closestKey)
    }

    updateCurrentTurn()
    viewport.addEventListener('scroll', updateCurrentTurn, { passive: true })
    return () => viewport.removeEventListener('scroll', updateCurrentTurn)
  }, [scrollViewportRef, turnRefs, turnInfos])

  // Auto-scroll the expanded list to keep current message visible
  useEffect(() => {
    if (!isHovered || !currentTurnKey || !listRef.current) return
    const activeEl = listRef.current.querySelector(`[data-turn-key="${currentTurnKey}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isHovered, currentTurnKey])

  const handleClick = useCallback(
    (turnKey: string) => {
      onScrollToTurn(turnKey)
    },
    [onScrollToTurn],
  )

  // Don't render if fewer than 2 turns
  if (turnInfos.length < 2) return null

  // The message being shown in the left pane: hovered item, or fall back to current
  const previewKey = hoveredTurnKey || currentTurnKey
  const previewInfo = previewKey
    ? turnInfos.find((t) => t.turnKey === previewKey)
    : null

  return (
    <div
      className="absolute right-0 top-4 bottom-4 z-20 flex items-start"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        setHoveredTurnKey(null)
      }}
    >
      {/* Expanded 2-pane popup */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200 ease-out',
          isHovered ? 'opacity-100 mr-1.5' : 'w-0 opacity-0 mr-0',
        )}
        style={isHovered ? { width: 420, height: 340 } : { width: 0 }}
      >
        <div
          className={cn(
            'h-full overflow-hidden rounded-xl flex',
            'bg-background border border-border/50',
            'shadow-[0_8px_40px_rgba(0,0,0,0.15),0_2px_12px_rgba(0,0,0,0.08)]',
          )}
        >
          {/* Left pane — summary of highlighted message */}
          <div className="w-[160px] shrink-0 border-r border-border/30 p-3 flex flex-col overflow-hidden">
            {previewInfo ? (
              <p className="text-[12px] leading-relaxed text-foreground/80 overflow-y-auto">
                {previewInfo.text || 'Empty message'}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground italic">
                Hover a message
              </p>
            )}
          </div>

          {/* Right pane — scrollable message list */}
          <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="py-1">
              {turnInfos.map((info) => {
                const isCurrent = info.turnKey === currentTurnKey
                const isUser = info.type === 'user'
                const isItemHovered = info.turnKey === hoveredTurnKey

                return (
                  <button
                    key={info.turnKey}
                    data-turn-key={info.turnKey}
                    onClick={() => handleClick(info.turnKey)}
                    onMouseEnter={() => setHoveredTurnKey(info.turnKey)}
                    onMouseLeave={() => setHoveredTurnKey(null)}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-[12px] leading-snug transition-colors',
                      'cursor-pointer truncate flex items-center gap-1.5',
                      isCurrent && 'bg-amber-500/10 font-medium',
                      isItemHovered && !isCurrent && 'bg-foreground/5',
                      isUser
                        ? 'text-foreground/80'
                        : 'text-muted-foreground/60',
                    )}
                  >
                    {info.hasAttachments && (
                      <Image className="h-3.5 w-3.5 shrink-0 opacity-40" />
                    )}
                    <span className="truncate">
                      {info.text || 'Empty message'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsed bar strip — 20px wide bars, 3px tall, 8px gaps */}
      <div className="w-[28px] flex flex-col items-end justify-start gap-[8px] py-2 pr-1 shrink-0">
        {turnInfos.map((info) => {
          const isCurrent = info.turnKey === currentTurnKey
          const isUser = info.type === 'user'

          return (
            <div
              key={info.turnKey}
              onClick={() => handleClick(info.turnKey)}
              className={cn(
                'w-[20px] rounded-[1px] cursor-pointer shrink-0 h-[3px]',
                isCurrent
                  ? 'bg-foreground/80'
                  : isUser
                    ? ''
                    : 'bg-foreground/12',
              )}
              style={
                !isCurrent && isUser
                  ? { backgroundColor: 'rgb(180, 140, 110)' }
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}
