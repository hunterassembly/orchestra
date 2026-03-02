/**
 * ChangedFilesList - Git status list for the "Changes" tab
 *
 * Shows modified/added/deleted/untracked files from `git status`.
 * Clicking a file opens a diff preview overlay.
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { FolderOpen, ExternalLink } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import type { GitStatusEntry } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { getFileTypeIcon } from './file-type-icons'

// ============================================================
// Status badge colors
// ============================================================

function getStatusColor(status: string): string {
  switch (status) {
    case 'M': return 'text-yellow-500'
    case 'A': return 'text-green-500'
    case 'D': return 'text-red-500'
    case '?': return 'text-muted-foreground'
    case 'R': return 'text-blue-500'
    default: return 'text-muted-foreground'
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'M': return 'M'
    case 'A': return 'A'
    case 'D': return 'D'
    case '?': return 'U'
    case 'R': return 'R'
    default: return status
  }
}

// ============================================================
// ChangedFilesList
// ============================================================

export interface ChangedFilesListProps {
  rootPath: string
}

export function ChangedFilesList({ rootPath }: ChangedFilesListProps) {
  const { onOpenFile, onOpenDiff } = useAppShellContext()
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)

  const loadStatus = useCallback(async () => {
    if (!rootPath) return
    setIsLoading(true)
    try {
      const result = await window.electronAPI.getGitStatus(rootPath)
      if (mountedRef.current) setEntries(result)
    } catch (error) {
      console.error('Failed to load git status:', error)
      if (mountedRef.current) setEntries([])
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [rootPath])

  // Initial load + watcher
  useEffect(() => {
    mountedRef.current = true
    loadStatus()

    // Re-use workspace file watcher to detect changes
    const unsubscribe = window.electronAPI.onWorkspaceFilesChanged((changedPath) => {
      if (changedPath === rootPath && mountedRef.current) {
        loadStatus()
      }
    })

    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [rootPath, loadStatus])

  const handleFileClick = useCallback(async (entry: GitStatusEntry) => {
    if (entry.status === '?') {
      // Untracked files — show as regular file preview
      onOpenFile(`${rootPath}/${entry.path}`)
      return
    }

    // Get diff and show in overlay
    try {
      const diff = await window.electronAPI.getGitDiff(rootPath, entry.path)
      if (diff) {
        onOpenDiff(entry.path, diff)
      } else {
        // No diff available, open as regular file
        onOpenFile(`${rootPath}/${entry.path}`)
      }
    } catch {
      onOpenFile(`${rootPath}/${entry.path}`)
    }
  }, [rootPath, onOpenFile, onOpenDiff])

  const handleRevealInFileManager = useCallback((entryPath: string) => {
    const fullPath = `${rootPath}/${entryPath}`
    window.electronAPI.showInFolder(fullPath)
  }, [rootPath])

  const fileManagerName = getFileManagerName()

  if (isLoading && entries.length === 0) {
    return (
      <div className="px-4 pt-2 text-muted-foreground select-none">
        <p className="text-xs">Loading...</p>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
        <p className="text-sm text-center">No changes</p>
      </div>
    )
  }

  return (
    <nav className="grid gap-0.5 px-2 pt-1">
      {entries.map((entry) => {
        const filename = entry.path.split('/').pop() || entry.path
        const dirPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''

        return (
          <ContextMenu key={entry.path}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => handleFileClick(entry)}
                className={cn(
                  'group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left',
                  'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                  'hover:bg-sidebar-hover transition-colors',
                  'px-2',
                )}
                title={entry.path}
              >
                {/* File type icon */}
                <span className="h-4 w-4 shrink-0 flex items-center justify-center">
                  {getFileTypeIcon(filename, 'file')}
                </span>

                {/* Filename + directory */}
                <span className="flex-1 min-w-0 flex items-baseline gap-1.5">
                  <span className="truncate">{filename}</span>
                  {dirPath && (
                    <span className="text-[11px] text-muted-foreground truncate shrink-0">
                      {dirPath}
                    </span>
                  )}
                </span>

                {/* Status badge */}
                <span className={cn(
                  'text-[11px] font-semibold shrink-0 w-4 text-center',
                  getStatusColor(entry.status),
                )}>
                  {getStatusLabel(entry.status)}
                </span>
              </button>
            </ContextMenuTrigger>
            <StyledContextMenuContent>
              <StyledContextMenuItem onSelect={() => handleFileClick(entry)}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open Diff
              </StyledContextMenuItem>
              <StyledContextMenuItem onSelect={() => handleRevealInFileManager(entry.path)}>
                <FolderOpen className="h-3.5 w-3.5" />
                {`Show in ${fileManagerName}`}
              </StyledContextMenuItem>
            </StyledContextMenuContent>
          </ContextMenu>
        )
      })}
    </nav>
  )
}
