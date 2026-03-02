/**
 * ChatMetadataBar - Row 1 of the chat header
 *
 * Shows: git branch > tracking branch | folder | Open | $cost
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { GitBranch, Folder, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { getFileManagerName } from '@/lib/platform'

const STOPLIGHT_PADDING = 84

export interface ChatMetadataBarProps {
  workingDirectory?: string
  costUsd?: number
  sessionMenu?: React.ReactNode
  rightSidebarButton?: React.ReactNode
}

export function ChatMetadataBar({
  workingDirectory,
  costUsd,
  sessionMenu,
  rightSidebarButton,
}: ChatMetadataBarProps) {
  const shouldCompensate = useCompensateForStoplight()
  const [gitBranch, setGitBranch] = useState<string | null>(null)

  // Fetch git branch
  useEffect(() => {
    if (workingDirectory) {
      window.electronAPI?.getGitBranch?.(workingDirectory).then((branch: string | null) => {
        setGitBranch(branch)
      })
    } else {
      setGitBranch(null)
    }
  }, [workingDirectory])

  const folderName = workingDirectory
    ? '/' + workingDirectory.split('/').pop()
    : null

  const handleOpenInFinder = () => {
    if (workingDirectory) {
      window.electronAPI.showInFolder(workingDirectory)
    }
  }

  const fileManagerName = getFileManagerName()

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 h-[32px] text-[12px] text-muted-foreground select-none',
        'titlebar-no-drag relative z-panel pr-2',
      )}
      style={{ paddingLeft: shouldCompensate ? STOPLIGHT_PADDING : 16 }}
    >
      {/* Left: git branch info */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {gitBranch && (
          <>
            <GitBranch className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <span className="font-medium text-foreground/70 truncate">{gitBranch}</span>
            <span className="opacity-30">{'>'}</span>
            <span className="opacity-50 truncate">origin/main</span>
          </>
        )}
      </div>

      {/* Right: folder, Open, cost, sidebar */}
      <div className="flex items-center gap-2 shrink-0">
        {folderName && (
          <span className="flex items-center gap-1 opacity-60">
            <Folder className="h-3 w-3" />
            <span>{folderName}</span>
          </span>
        )}

        {workingDirectory && (
          <button
            onClick={handleOpenInFinder}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded-md',
              'hover:bg-foreground/5 transition-colors text-muted-foreground',
              'border border-border/40',
            )}
            title={`Show in ${fileManagerName}`}
          >
            <span className="text-[11px]">Open</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        )}

        {costUsd != null && costUsd > 0 && (
          <span className="tabular-nums font-medium text-foreground/50">
            ${costUsd.toFixed(2)}
          </span>
        )}

        {sessionMenu}
        {rightSidebarButton}
      </div>
    </div>
  )
}
