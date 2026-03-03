/**
 * ChatMetadataBar - Row 1 of the chat header
 *
 * Shows: git branch > tracking branch | folder | Open | $cost
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Check, ChevronDown, ExternalLink, Folder, FolderOpen, GitBranch, GitCompareArrows } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import { getFileManagerName } from '@/lib/platform'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { toast } from 'sonner'
import type { GitRepoInfo } from '../../../shared/types'

const STOPLIGHT_PADDING = 84

export interface ChatMetadataBarProps {
  workingDirectory?: string
  costUsd?: number
  contextTokens?: number
  showContextTokens?: boolean
  sessionMenu?: React.ReactNode
  rightSidebarButton?: React.ReactNode
  onSelectBranch?: (branch: string, gitRepoInfo: GitRepoInfo) => void
}

export function ChatMetadataBar({
  workingDirectory,
  costUsd,
  contextTokens,
  showContextTokens,
  sessionMenu,
  rightSidebarButton,
  onSelectBranch,
}: ChatMetadataBarProps) {
  const shouldCompensate = useCompensateForStoplight()
  const [gitRepoInfo, setGitRepoInfo] = useState<GitRepoInfo | null>(null)

  // Fetch git repo metadata
  useEffect(() => {
    if (workingDirectory) {
      const request = window.electronAPI?.getGitRepoInfo?.(workingDirectory)
      if (!request) {
        setGitRepoInfo(null)
        return
      }

      request
        .then((info: GitRepoInfo | null) => {
          setGitRepoInfo(info)
        })
        .catch((error) => {
          console.warn('[ChatMetadataBar] Failed to load git repo info:', error)
          setGitRepoInfo(null)
        })
    } else {
      setGitRepoInfo(null)
    }
  }, [workingDirectory])

  const handleOpenInFinder = React.useCallback((targetPath: string) => {
    window.electronAPI.showInFolder(targetPath)
  }, [])

  const fileManagerName = getFileManagerName()
  const branchLabel = gitRepoInfo?.trackingBranch ?? gitRepoInfo?.currentBranch ?? null

  const handleBranchRowClick = React.useCallback(async (branch: string) => {
    if (branch === gitRepoInfo?.currentBranch) return
    if (gitRepoInfo && onSelectBranch) {
      await onSelectBranch(branch, gitRepoInfo)
      if (workingDirectory) {
        const refreshed = await window.electronAPI?.getGitRepoInfo?.(workingDirectory)
        setGitRepoInfo(refreshed ?? null)
      }
      return
    }
    toast.info(`Available branch: ${branch}`, { description: 'Branch switching from the header is coming next.' })
  }, [gitRepoInfo, onSelectBranch, workingDirectory])

  const formatContextTokens = React.useCallback((value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
    return `${value}`
  }, [])

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 h-[32px] text-[13px] text-muted-foreground select-none',
        'titlebar-no-drag relative z-panel pr-2',
      )}
      style={{ paddingLeft: shouldCompensate ? STOPLIGHT_PADDING : 16 }}
    >
      {/* Left: folder + branch */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {gitRepoInfo && (
          <>
            <Folder className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="font-medium text-foreground/80 truncate">
              {(workingDirectory?.split('/').filter(Boolean).pop()) || gitRepoInfo.repoName}
            </span>
            <span className="opacity-30">{'>'}</span>
            {branchLabel && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-foreground/65 hover:bg-foreground/5"
                  >
                    <GitBranch className="h-3.5 w-3.5 opacity-70" />
                    <span className="truncate max-w-[220px]">{branchLabel}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <StyledDropdownMenuContent align="start" minWidth="min-w-56">
                  <StyledDropdownMenuItem disabled>
                    <GitCompareArrows className="h-3.5 w-3.5" />
                    <span className="flex-1">Branches</span>
                  </StyledDropdownMenuItem>
                  <StyledDropdownMenuSeparator />
                  {gitRepoInfo.branches.map((branch) => (
                    <StyledDropdownMenuItem
                      key={branch}
                      onClick={() => handleBranchRowClick(branch)}
                    >
                      {branch === gitRepoInfo.currentBranch
                        ? <Check className="h-3.5 w-3.5" />
                        : <span className="h-3.5 w-3.5" />}
                      <span className="flex-1">{branch}</span>
                    </StyledDropdownMenuItem>
                  ))}
                </StyledDropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>

      {/* Right: worktree, create actions, cost, sidebar */}
      <div className="flex items-center gap-2 shrink-0">
        {gitRepoInfo?.isWorktree && gitRepoInfo.worktreeName && (
          <span className="flex items-center gap-1 opacity-60">
            <FolderOpen className="h-3 w-3" />
            <span>/{gitRepoInfo.worktreeName}</span>
          </span>
        )}

        {gitRepoInfo?.isWorktree && workingDirectory && (
          <button
            onClick={() => handleOpenInFinder(workingDirectory)}
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

        {showContextTokens && contextTokens != null && contextTokens > 0 ? (
          <span className="min-w-[64px] text-right tabular-nums font-medium text-foreground/50" title={`${contextTokens.toLocaleString()} context tokens`}>
            {formatContextTokens(contextTokens)} ctx
          </span>
        ) : costUsd != null && costUsd > 0 ? (
          <span className="min-w-[44px] text-right tabular-nums font-medium text-foreground/50">
            ${costUsd.toFixed(2)}
          </span>
        ) : null}
        {rightSidebarButton}
        {sessionMenu}
      </div>
    </div>
  )
}
