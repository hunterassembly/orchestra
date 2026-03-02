/**
 * WorkspaceFilesPanel - Full workspace file tree for the right sidebar
 *
 * Shows all files in the workspace root directory with:
 * - Lazy-loaded directory expansion (one level at a time via IPC)
 * - File-type-specific icons
 * - Context menu (Open, Show in Finder)
 * - File watcher for auto-refresh
 * - Persisted expanded folder state
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { ChevronRight, FolderOpen, ExternalLink } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { useAppShellContext, useActiveWorkspace, useSession as useSessionData } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { getFileTypeIcon } from './file-type-icons'
import { ChangedFilesList } from './ChangedFilesList'

// ============================================================
// Animation variants (matches SessionFilesSection)
// ============================================================

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.02, delayChildren: 0.01 },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.01, staggerDirection: -1 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -6 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.12, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -6,
    transition: { duration: 0.08, ease: 'easeIn' },
  },
}

// ============================================================
// FileTreeItem (recursive)
// ============================================================

interface FileTreeItemProps {
  file: SessionFile
  depth: number
  expandedPaths: Set<string>
  childrenCache: Map<string, SessionFile[]>
  loadingPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (file: SessionFile) => void
  onRevealInFileManager: (path: string) => void
}

const FileTreeItem = memo(function FileTreeItem({
  file,
  depth,
  expandedPaths,
  childrenCache,
  loadingPaths,
  onToggleExpand,
  onFileClick,
  onRevealInFileManager,
}: FileTreeItemProps) {
  const isDirectory = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  const isLoading = loadingPaths.has(file.path)
  const children = childrenCache.get(file.path)

  const handleClick = () => {
    if (isDirectory) {
      onToggleExpand(file.path)
    } else {
      onFileClick(file)
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDirectory) {
      onToggleExpand(file.path)
    }
  }

  const fileManagerName = getFileManagerName()

  return (
    <div className="min-w-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={handleClick}
            className={cn(
              'group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left',
              'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
              'hover:bg-sidebar-hover transition-colors',
              'px-2',
            )}
            title={file.path}
          >
            {/* Icon with hover chevron for directories */}
            <span className="relative h-4 w-4 shrink-0 flex items-center justify-center">
              {isDirectory ? (
                <>
                  <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-150">
                    {getFileTypeIcon(file.name, 'directory', isExpanded)}
                  </span>
                  <span
                    className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
                    onClick={handleChevronClick}
                  >
                    <ChevronRight
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform duration-200',
                        isExpanded && 'rotate-90',
                      )}
                    />
                  </span>
                </>
              ) : (
                getFileTypeIcon(file.name, 'file')
              )}
            </span>

            <span className="flex-1 min-w-0 truncate">{file.name}</span>
          </button>
        </ContextMenuTrigger>
        <StyledContextMenuContent>
          {file.type !== 'directory' && (
            <StyledContextMenuItem onSelect={() => onFileClick(file)}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </StyledContextMenuItem>
          )}
          <StyledContextMenuItem onSelect={() => onRevealInFileManager(file.path)}>
            <FolderOpen className="h-3.5 w-3.5" />
            {`Show in ${fileManagerName}`}
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>

      {/* Expandable children */}
      {isDirectory && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 4 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="flex flex-col select-none min-w-0">
                <motion.nav
                  className="grid gap-0.5 pl-5 pr-0 relative"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {/* Vertical connector line */}
                  <div
                    className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
                    aria-hidden="true"
                  />
                  {isLoading && !children ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div>
                  ) : children && children.length > 0 ? (
                    children.map((child) => (
                      <motion.div key={child.path} variants={itemVariants} className="min-w-0">
                        <FileTreeItem
                          file={child}
                          depth={depth + 1}
                          expandedPaths={expandedPaths}
                          childrenCache={childrenCache}
                          loadingPaths={loadingPaths}
                          onToggleExpand={onToggleExpand}
                          onFileClick={onFileClick}
                          onRevealInFileManager={onRevealInFileManager}
                        />
                      </motion.div>
                    ))
                  ) : (
                    <div className="px-2 py-1 text-xs text-muted-foreground italic">Empty</div>
                  )}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
})

// ============================================================
// WorkspaceFilesPanel
// ============================================================

export interface WorkspaceFilesPanelProps {
  sessionId?: string
  closeButton?: React.ReactNode
}

export function WorkspaceFilesPanel({ sessionId, closeButton }: WorkspaceFilesPanelProps) {
  const session = useSessionData(sessionId || '')
  const workspace = useActiveWorkspace()
  // Use the session's working directory (the repo it's operating in),
  // falling back to the workspace root
  const rootPath = session?.workingDirectory || workspace?.rootPath
  const { onOpenFile, openFileAsTabRef } = useAppShellContext()

  const [rootFiles, setRootFiles] = useState<SessionFile[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [childrenCache, setChildrenCache] = useState<Map<string, SessionFile[]>>(new Map())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)

  // Load persisted expanded state
  useEffect(() => {
    if (rootPath) {
      const saved = storage.get<string[]>(storage.KEYS.workspaceFilesExpandedFolders, [])
      setExpandedPaths(new Set(saved))
    } else {
      setExpandedPaths(new Set())
    }
  }, [rootPath])

  // Save expanded state
  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    storage.set(storage.KEYS.workspaceFilesExpandedFolders, Array.from(paths))
  }, [])

  // Load root-level files
  const loadRootFiles = useCallback(async () => {
    if (!rootPath) {
      setRootFiles([])
      return
    }
    setIsLoading(true)
    try {
      const files = await window.electronAPI.getWorkspaceFiles(rootPath)
      if (mountedRef.current) {
        setRootFiles(files)
      }
    } catch (error) {
      console.error('Failed to load workspace files:', error)
      if (mountedRef.current) setRootFiles([])
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [rootPath])

  // Load children for a directory (lazy)
  const loadChildren = useCallback(async (dirPath: string) => {
    setLoadingPaths((prev) => new Set(prev).add(dirPath))
    try {
      const files = await window.electronAPI.getWorkspaceFiles(dirPath)
      if (mountedRef.current) {
        setChildrenCache((prev) => {
          const next = new Map(prev)
          next.set(dirPath, files)
          return next
        })
      }
    } catch (error) {
      console.error('Failed to load directory:', dirPath, error)
    } finally {
      if (mountedRef.current) {
        setLoadingPaths((prev) => {
          const next = new Set(prev)
          next.delete(dirPath)
          return next
        })
      }
    }
  }, [])

  // Initial load + watcher
  useEffect(() => {
    mountedRef.current = true
    loadRootFiles()

    if (rootPath) {
      window.electronAPI.watchWorkspaceFiles(rootPath)

      const unsubscribe = window.electronAPI.onWorkspaceFilesChanged((changedPath) => {
        if (changedPath === rootPath && mountedRef.current) {
          loadRootFiles()
        }
      })

      return () => {
        mountedRef.current = false
        unsubscribe()
        window.electronAPI.unwatchWorkspaceFiles()
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [rootPath, loadRootFiles])

  // Re-load expanded directories when they were already cached
  // (handles case where watcher fires and we need to refresh open folders)
  useEffect(() => {
    if (rootFiles.length > 0) {
      for (const path of expandedPaths) {
        if (childrenCache.has(path)) {
          loadChildren(path)
        }
      }
    }
    // Only re-run when rootFiles change (watcher triggered reload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootFiles])

  // Toggle expand/collapse
  const handleToggleExpand = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
          // Load children if not cached
          if (!childrenCache.has(path)) {
            loadChildren(path)
          }
        }
        saveExpandedPaths(next)
        return next
      })
    },
    [childrenCache, loadChildren, saveExpandedPaths],
  )

  const handleFileClick = useCallback(
    (file: SessionFile) => {
      if (file.type === 'directory') {
        // eslint-disable-next-line craft-links/no-direct-file-open -- directories can't be previewed in-app
        window.electronAPI.openFile(file.path)
      } else if (openFileAsTabRef?.current) {
        // Open as tab in active chat when available
        openFileAsTabRef.current(file.path)
      } else {
        onOpenFile(file.path)
      }
    },
    [onOpenFile, openFileAsTabRef],
  )

  const handleRevealInFileManager = useCallback((path: string) => {
    window.electronAPI.showInFolder(path)
  }, [])

  // Persisted active tab
  const [activeTab, setActiveTab] = useState(() =>
    storage.get<string>(storage.KEYS.workspaceFilesActiveTab, 'files')
  )

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value)
    storage.set(storage.KEYS.workspaceFilesActiveTab, value)
  }, [])

  if (!rootPath) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex shrink-0 items-center px-2 pr-2 min-w-0 gap-1 h-[50px] titlebar-no-drag relative z-panel">
          <div className="flex-1" />
          {closeButton && <div className="shrink-0">{closeButton}</div>}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground p-4">
          <p className="text-sm text-center">No workspace selected</p>
        </div>
      </div>
    )
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
      {/* Header with tabs and close button */}
      <div className="flex shrink-0 items-center px-2 pr-2 min-w-0 gap-1 h-[50px] titlebar-no-drag relative z-panel">
        <div className="flex-1 min-w-0 flex items-center pl-1">
          <TabsList className="h-7 bg-transparent p-0 gap-0">
            <TabsTrigger
              value="files"
              className="h-7 rounded-md px-2.5 py-0 text-xs font-medium data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              All files
            </TabsTrigger>
            <TabsTrigger
              value="changes"
              className="h-7 rounded-md px-2.5 py-0 text-xs font-medium data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              Changes
            </TabsTrigger>
          </TabsList>
        </div>
        {closeButton && <div className="shrink-0">{closeButton}</div>}
      </div>

      {/* All files tab */}
      <TabsContent value="files" className="flex-1 overflow-y-auto overflow-x-hidden pb-2 min-h-0 mt-0">
        {rootFiles.length === 0 ? (
          <div className="px-4 pt-2 text-muted-foreground select-none">
            <p className="text-xs">{isLoading ? 'Loading...' : 'No files found.'}</p>
          </div>
        ) : (
          <nav className="grid gap-0.5 px-2 pt-1">
            {rootFiles.map((file) => (
              <FileTreeItem
                key={file.path}
                file={file}
                depth={0}
                expandedPaths={expandedPaths}
                childrenCache={childrenCache}
                loadingPaths={loadingPaths}
                onToggleExpand={handleToggleExpand}
                onFileClick={handleFileClick}
                onRevealInFileManager={handleRevealInFileManager}
              />
            ))}
          </nav>
        )}
      </TabsContent>

      {/* Changes tab */}
      <TabsContent value="changes" className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden pb-2 min-h-0 mt-0">
        <ChangedFilesList rootPath={rootPath} />
      </TabsContent>
    </Tabs>
  )
}
