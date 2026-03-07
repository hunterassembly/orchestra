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
import { ChevronDown, ChevronRight, FolderOpen, ExternalLink, GitBranch, GitCompareArrows, MoreHorizontal, FileText, Network, Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuTrigger, StyledDropdownMenuContent, StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { toast } from 'sonner'
import type { GitRepoInfo, GitStatusEntry, SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { useAppShellContext, useActiveWorkspace, useSession as useSessionData } from '@/context/AppShellContext'
import { getFileManagerName, isMac } from '@/lib/platform'
import { getFileTypeIcon } from './file-type-icons'
import { ChangedFilesList } from './ChangedFilesList'
import { TiptapMarkdownEditor } from '@craft-agent/ui'

interface VaultNote {
  id: string
  path: string
  relativePath: string
  title: string
}

type VaultNotesLoadState = 'idle' | 'loading' | 'loaded' | 'error'

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
  vaultRootPath?: string | null
}

export function WorkspaceFilesPanel({ sessionId, closeButton, vaultRootPath = null }: WorkspaceFilesPanelProps) {
  const session = useSessionData(sessionId || '')
  const workspace = useActiveWorkspace()
  // Use the session's working directory (the repo it's operating in),
  // falling back to the workspace root
  const rootPath = session?.workingDirectory || workspace?.rootPath
  const { onOpenFile, openFileAsTabRef, openWorkflowTabRef, getDraft, onInputChange, textareaRef, onSendMessage } = useAppShellContext()

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
    storage.get<string>(storage.KEYS.workspaceFilesActiveTab, 'changes')
  )
  const [changedEntries, setChangedEntries] = useState<GitStatusEntry[]>([])
  const [gitRepoInfo, setGitRepoInfo] = useState<GitRepoInfo | null>(null)
  const lastReviewFingerprintRef = useRef<string | null>(null)
  const [resolvedVaultRootPath, setResolvedVaultRootPath] = useState<string | null>(vaultRootPath)
  const [vaultNotesLoadState, setVaultNotesLoadState] = useState<VaultNotesLoadState>('idle')
  const [vaultNotes, setVaultNotes] = useState<VaultNote[]>([])
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null)
  const [selectedNoteContent, setSelectedNoteContent] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [incomingBacklinks, setIncomingBacklinks] = useState<VaultNote[]>([])
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (vaultRootPath?.trim()) {
      setResolvedVaultRootPath(vaultRootPath.trim())
      return
    }

    let cancelled = false
    const loadVaultPath = async () => {
      try {
        const prefs = await window.electronAPI.readPreferences()
        const parsed = JSON.parse(prefs.content || '{}') as { vault?: { path?: string } }
        if (!cancelled) {
          setResolvedVaultRootPath(parsed?.vault?.path?.trim() || null)
        }
      } catch (error) {
        console.error('[notes-tray] Failed to load vault path from preferences:', error)
        if (!cancelled) {
          setResolvedVaultRootPath(null)
        }
      }
    }

    void loadVaultPath()
    return () => {
      cancelled = true
    }
  }, [vaultRootPath])

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value)
    storage.set(storage.KEYS.workspaceFilesActiveTab, value)
  }, [])

  const effectiveRootPath = React.useMemo(
    () => resolvedVaultRootPath || workspace?.rootPath || null,
    [resolvedVaultRootPath, workspace?.rootPath],
  )

  const notesRootPath = React.useMemo(() => {
    if (!effectiveRootPath) return null
    return resolvedVaultRootPath
      ? effectiveRootPath.replace(/\/$/, '')
      : `${effectiveRootPath.replace(/\/$/, '')}/notes`
  }, [effectiveRootPath, resolvedVaultRootPath])

  const toRelativePath = useCallback((absolutePath: string): string => {
    if (!effectiveRootPath) return absolutePath
    const normalizedRoot = effectiveRootPath.replace(/\/+$/, '')
    const normalizedPath = absolutePath.replace(/\\/g, '/')
    const rootWithSlash = `${normalizedRoot}/`
    if (normalizedPath.startsWith(rootWithSlash)) {
      return normalizedPath.slice(rootWithSlash.length)
    }
    if (normalizedPath.startsWith(normalizedRoot)) {
      return normalizedPath.slice(normalizedRoot.length).replace(/^\/+/, '')
    }
    return absolutePath
  }, [effectiveRootPath])

  const selectedAbsolutePath = React.useMemo(() => {
    if (!effectiveRootPath || !selectedNotePath) return null
    return `${effectiveRootPath.replace(/\/$/, '')}/${selectedNotePath}`
  }, [effectiveRootPath, selectedNotePath])

  const listMarkdownNotes = useCallback(async (dirPath: string): Promise<VaultNote[]> => {
    const entries = await window.electronAPI.getWorkspaceFiles(dirPath)
    const nested = await Promise.all(entries.map(async (entry) => {
      if (entry.type === 'directory') return listMarkdownNotes(entry.path)
      const lower = entry.name.toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown') && !lower.endsWith('.mdc')) return []
      const relativePath = toRelativePath(entry.path)
      return [{
        id: entry.path,
        path: entry.path,
        relativePath,
        title: entry.name.replace(/\.(md|markdown)$/i, ''),
      }]
    }))
    return nested.flat()
  }, [toRelativePath])

  const loadVaultNotes = useCallback(async () => {
    if (!notesRootPath) {
      setVaultNotes([])
      setVaultNotesLoadState('idle')
      return
    }
    try {
      setVaultNotesLoadState('loading')
      const notes = await listMarkdownNotes(notesRootPath)
      notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      setVaultNotes(notes)
      setVaultNotesLoadState('loaded')
      if (notes.length > 0 && !selectedNotePath) {
        setSelectedNotePath(notes[0].relativePath)
      }
    } catch (error) {
      console.error('[notes-tray] Failed to load notes:', { notesRootPath, error })
      setVaultNotes([])
      setVaultNotesLoadState('error')
    }
  }, [notesRootPath, listMarkdownNotes, selectedNotePath])

  const createNewVaultNote = useCallback(async () => {
    if (!effectiveRootPath || !notesRootPath) return
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const fileName = `note-${stamp}.md`
    const relativePath = resolvedVaultRootPath ? fileName : `notes/${fileName}`
    const initial = `# ${fileName.replace(/\.md$/i, '')}\n\n`
    try {
      if (resolvedVaultRootPath) {
        await window.electronAPI.writeVaultText(resolvedVaultRootPath, relativePath, initial)
      } else if (workspace?.id) {
        await window.electronAPI.writeWorkspaceText(workspace.id, relativePath, initial)
      } else {
        throw new Error('Workspace not available for note creation')
      }
      await loadVaultNotes()
      setSelectedNotePath(relativePath)
      setSelectedNoteContent(initial)
      toast.success('Created new note')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create note'
      toast.error(message)
    }
  }, [effectiveRootPath, notesRootPath, resolvedVaultRootPath, workspace?.id, loadVaultNotes])

  useEffect(() => {
    if (!rootPath) {
      setGitRepoInfo(null)
      return
    }

    window.electronAPI.getGitRepoInfo(rootPath)
      .then(setGitRepoInfo)
      .catch(() => setGitRepoInfo(null))
  }, [rootPath])

  // Load vault notes whenever workspace changes
  useEffect(() => {
    void loadVaultNotes()
  }, [loadVaultNotes])

  // Load selected note content
  useEffect(() => {
    if (!selectedNotePath) {
      setSelectedNoteContent('')
      setIncomingBacklinks([])
      return
    }
    const readPromise = resolvedVaultRootPath
      ? window.electronAPI.readVaultText(resolvedVaultRootPath, selectedNotePath)
      : (selectedAbsolutePath ? window.electronAPI.readFile(selectedAbsolutePath) : Promise.resolve(''))
    readPromise
      .then((content) => setSelectedNoteContent(content || ''))
      .catch(() => setSelectedNoteContent(''))
  }, [resolvedVaultRootPath, selectedAbsolutePath, selectedNotePath])

  // Recompute backlinks (simple wikilink resolver by title)
  useEffect(() => {
    if (!selectedNotePath || vaultNotes.length === 0) {
      setIncomingBacklinks([])
      return
    }
    const selected = vaultNotes.find((note) => note.relativePath === selectedNotePath)
    if (!selected) {
      setIncomingBacklinks([])
      return
    }
    const title = selected.title.toLowerCase()
    let cancelled = false
    ;(async () => {
      const linkedFrom: VaultNote[] = []
      await Promise.all(vaultNotes.map(async (note) => {
        if (note.path === selected.path) return
        try {
          const content = resolvedVaultRootPath
            ? await window.electronAPI.readVaultText(resolvedVaultRootPath, note.relativePath)
            : await window.electronAPI.readFile(note.path)
          const matches = content.match(/\[\[([^\]]+)\]\]/g) || []
          const hasLink = matches.some((m) => m.replace(/^\[\[|\]\]$/g, '').trim().toLowerCase() === title)
          if (hasLink) linkedFrom.push(note)
        } catch {
          // ignore
        }
      }))
      if (!cancelled) {
        linkedFrom.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        setIncomingBacklinks(linkedFrom)
      }
    })()
    return () => { cancelled = true }
  }, [resolvedVaultRootPath, selectedNotePath, vaultNotes])

  const handlePrefillPrompt = useCallback((label: string, prompt: string) => {
    if (openWorkflowTabRef?.current) {
      openWorkflowTabRef.current({ label, prompt, autoSend: true })
      return
    }

    if (!sessionId) return
    const current = getDraft(sessionId).trim()
    const next = current.length > 0 ? `${current}\n\n${prompt}` : prompt
    onInputChange(sessionId, next)
    textareaRef?.current?.focus()
    toast.success('Added draft prompt to input')
  }, [openWorkflowTabRef, sessionId, getDraft, onInputChange, textareaRef])

  const handleDraftCommit = useCallback(() => {
    const currentBranch = gitRepoInfo?.currentBranch ?? 'current branch'
    const targetBranch = gitRepoInfo?.trackingBranch ?? 'origin/main'
    const hasUpstream = !!gitRepoInfo?.trackingBranch
    handlePrefillPrompt('Make Commit', [
      'The user requested a commit.',
      `Current branch: ${currentBranch}`,
      `Target branch: ${targetBranch}`,
      `Upstream branch exists: ${hasUpstream ? 'yes' : 'no'}`,
      `There are ${changedEntries.length} uncommitted changes.`,
      '',
      'Follow these steps:',
      '1) If you have any skills related to commits, invoke them now. Those instructions take precedence.',
      '2) Run git diff to review uncommitted changes.',
      '3) Commit all uncommitted changes.',
      '4) Follow any user instructions about commit message format.',
      '',
      'If any step fails, ask the user for help.',
    ].join('\n'))
  }, [changedEntries.length, gitRepoInfo?.currentBranch, gitRepoInfo?.trackingBranch, handlePrefillPrompt])

  const handleDraftPr = useCallback(() => {
    const currentBranch = gitRepoInfo?.currentBranch ?? 'current branch'
    const targetBranch = gitRepoInfo?.trackingBranch ?? 'origin/main'
    const hasUpstream = !!gitRepoInfo?.trackingBranch
    handlePrefillPrompt('Create PR', [
      'The user likes the current state of the code and requested a PR.',
      `Current branch: ${currentBranch}`,
      `Target branch: ${targetBranch}`,
      `Upstream branch exists: ${hasUpstream ? 'yes' : 'no'}`,
      `There are ${changedEntries.length} uncommitted changes.`,
      '',
      'Follow these steps to create the PR:',
      '1) If you have any skills related to creating PRs, invoke them now. Instructions there take precedence.',
      '2) Run git diff to review uncommitted changes.',
      '3) Commit the uncommitted changes. Follow any user commit-message instructions.',
      '4) Push to origin.',
      '5) Use mcp__conductor__GetWorkspaceDiff to review the PR diff.',
      '6) Use gh pr create --base main to create a PR onto the target branch.',
      '7) Keep the title under 80 characters.',
      '8) Keep the description under five sentences unless user instructed otherwise.',
      '9) Describe ALL changes in the workspace diff, not just this session.',
      '',
      'If any step fails, ask the user for help.',
    ].join('\n'))
  }, [changedEntries.length, gitRepoInfo?.currentBranch, gitRepoInfo?.trackingBranch, handlePrefillPrompt])

  const reviewPrompt = useCallback((entries: GitStatusEntry[]) => {
    const files = entries.slice(0, 200).map((entry) => `- ${entry.path} [${entry.status}]`).join('\n')
    return [
      'Run an automated code review for my current uncommitted changes.',
      '',
      'Context:',
      '- Backend: Codex',
      '- Objective: high-signal issues only (real bugs, clear rule violations)',
      '- Ignore style nitpicks and speculative concerns.',
      '',
      'Required workflow:',
      '1) Discover relevant AGENTS.md/CLAUDE.md files (root + folders that contain changed files).',
      '2) Summarize the full diff.',
      '3) Perform 4 independent review passes in parallel:',
      '   - Two passes for AGENTS.md/CLAUDE.md compliance',
      '   - Two passes for bugs/security/logic issues in changed code only',
      '4) Validate every flagged issue with a second pass before reporting.',
      '5) Return ONLY validated high-confidence issues with:',
      '   - title',
      '   - why it is an issue',
      '   - file path',
      '   - line/context from diff',
      '   - category (bug, security, compliance)',
      '',
      'Changed files:',
      files || '- (no changed files detected)',
    ].join('\n')
  }, [])

  useEffect(() => {
    if (activeTab !== 'review' || !sessionId || changedEntries.length === 0) return

    const fingerprint = changedEntries
      .map((entry) => `${entry.path}:${entry.status}`)
      .sort()
      .join('|')

    if (lastReviewFingerprintRef.current === fingerprint) return
    lastReviewFingerprintRef.current = fingerprint

    if (openWorkflowTabRef?.current) {
      openWorkflowTabRef.current({
        label: 'Code Review',
        prompt: reviewPrompt(changedEntries),
        autoSend: true,
      })
    } else {
      onSendMessage(sessionId, reviewPrompt(changedEntries))
    }
    toast.success('Review started', { description: 'Sent automated review prompt to chat.' })
  }, [activeTab, sessionId, changedEntries, onSendMessage, openWorkflowTabRef, reviewPrompt])

  const saveVaultNote = useCallback((markdown: string) => {
    if (!selectedNotePath) return
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current)
    setSelectedNoteContent(markdown)
    setIsSavingNote(true)
    noteSaveTimerRef.current = setTimeout(() => {
      const writePromise = resolvedVaultRootPath
        ? window.electronAPI.writeVaultText(resolvedVaultRootPath, selectedNotePath, markdown)
        : (workspace?.id
          ? window.electronAPI.writeWorkspaceText(workspace.id, selectedNotePath, markdown)
          : Promise.reject(new Error('Workspace not found for note write')))
      writePromise
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to save note'
          toast.error(message)
        })
        .finally(() => {
          setIsSavingNote(false)
          noteSaveTimerRef.current = null
        })
    }, 350)
  }, [resolvedVaultRootPath, selectedNotePath, workspace?.id])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTypingTarget =
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable
      if (isTypingTarget) return

      if (event.key === '1') {
        event.preventDefault()
        handleTabChange('files')
      } else if (event.key === '2') {
        event.preventDefault()
        handleTabChange('changes')
      } else if (event.key === '3') {
        event.preventDefault()
        handleTabChange('checks')
      } else if (event.key === '4') {
        event.preventDefault()
        handleTabChange('review')
      } else if (event.key === '5') {
        event.preventDefault()
        handleTabChange('notes')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleTabChange])

  useEffect(() => {
    return () => {
      if (noteSaveTimerRef.current) {
        clearTimeout(noteSaveTimerRef.current)
        noteSaveTimerRef.current = null
      }
    }
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
      {/* Header row 1: actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 px-2 pt-2 pb-1 titlebar-no-drag relative z-panel">
        {sessionId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HeaderIconButton
                icon={(
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    Create PR
                    <ChevronDown className="h-3 w-3" />
                  </span>
                )}
                className="h-7 w-auto px-2 text-foreground cursor-pointer"
              />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" minWidth="min-w-52">
              <StyledDropdownMenuItem onClick={handleDraftCommit} disabled={changedEntries.length === 0}>
                <GitBranch className="h-3.5 w-3.5" />
                Make Commit
              </StyledDropdownMenuItem>
              <StyledDropdownMenuItem onClick={handleDraftPr} disabled={changedEntries.length === 0}>
                <GitCompareArrows className="h-3.5 w-3.5" />
                Create PR
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem disabled>
                <MoreHorizontal className="h-3.5 w-3.5" />
                More soon
              </StyledDropdownMenuItem>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        )}
        {closeButton && <div className="shrink-0">{closeButton}</div>}
      </div>

      {/* Header row 2: tabs */}
      <div className="shrink-0 px-2 pb-2">
        <div className="overflow-x-auto">
          <TabsList className="h-7 bg-transparent p-0 gap-0 w-max min-w-full justify-start">
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="files"
                  className="h-7 rounded-md px-2.5 py-0 text-xs font-medium cursor-pointer data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  All files
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>Workspace files {isMac ? '⌥1' : 'Alt+1'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="changes"
                  className="h-7 rounded-md px-2.5 py-0 text-xs font-medium cursor-pointer data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Changes {changedEntries.length > 0 ? changedEntries.length : ''}
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>Changed files {isMac ? '⌥2' : 'Alt+2'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="checks"
                  className="h-7 rounded-md px-2.5 py-0 text-xs font-medium cursor-pointer data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Checks
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>Checks {isMac ? '⌥3' : 'Alt+3'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="review"
                  className="h-7 rounded-md px-2.5 py-0 text-xs font-medium cursor-pointer data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Review
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>Run review {isMac ? '⌥4' : 'Alt+4'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="notes"
                  className="h-7 rounded-md px-2.5 py-0 text-xs font-medium cursor-pointer data-[state=active]:bg-muted data-[state=active]:shadow-none"
                >
                  Notes
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>Local vault notes {isMac ? '⌥5' : 'Alt+5'}</TooltipContent>
            </Tooltip>
          </TabsList>
        </div>
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
        <ChangedFilesList rootPath={rootPath} onEntriesChange={setChangedEntries} />
      </TabsContent>

      {/* Checks tab */}
      <TabsContent value="checks" className="flex-1 flex items-center justify-center text-muted-foreground min-h-0 mt-0">
        <p className="text-sm">Checks coming soon</p>
      </TabsContent>

      {/* Review tab */}
      <TabsContent value="review" className="flex-1 flex items-center justify-center text-muted-foreground min-h-0 mt-0">
        <p className="text-sm">
          {changedEntries.length > 0
            ? 'Review auto-starts in chat for current changes.'
            : 'No changes to review.'}
        </p>
      </TabsContent>

      {/* Notes tab (local markdown vault) */}
      <TabsContent value="notes" className="flex-1 min-h-0 mt-0">
        <div className="h-full grid grid-cols-[220px_1fr] min-h-0">
          <div className="border-r border-border/40 min-h-0 flex flex-col">
            <div className="h-9 px-2 flex items-center justify-between border-b border-border/40">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Vault</span>
              <button
                type="button"
                onClick={createNewVaultNote}
                className="h-6 w-6 rounded-md hover:bg-muted inline-flex items-center justify-center text-muted-foreground"
                title="New note"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-1.5 space-y-0.5">
              {vaultNotesLoadState === 'loading' ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">Loading notes…</div>
              ) : vaultNotesLoadState === 'error' ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Unable to load notes
                </div>
              ) : vaultNotes.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {resolvedVaultRootPath ? 'No notes found in vault' : 'No notes yet'}
                </div>
              ) : (
                vaultNotes.map((note) => (
                  <button
                    key={note.path}
                    onClick={() => setSelectedNotePath(note.relativePath)}
                    className={cn(
                      'w-full text-left rounded-md px-2 py-1.5 text-xs cursor-pointer',
                      selectedNotePath === note.relativePath ? 'bg-muted text-foreground' : 'text-foreground/80 hover:bg-sidebar-hover',
                    )}
                    title={note.relativePath}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{note.title}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate pl-5">{note.relativePath}</div>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="min-h-0 flex flex-col">
            <div className="h-9 px-3 border-b border-border/40 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">
                  {selectedNotePath ? (vaultNotes.find((note) => note.relativePath === selectedNotePath)?.title || 'Note') : 'Select a note'}
                </div>
              </div>
              <div className="text-[10px] text-muted-foreground">{isSavingNote ? 'Saving…' : ''}</div>
            </div>
            <div className="flex-1 min-h-0 grid grid-rows-[1fr_auto]">
              <div className="min-h-0 overflow-auto px-3 py-2">
                <div className="mx-auto w-full max-w-[806px] h-full">
                  {selectedNotePath ? (
                    <TiptapMarkdownEditor
                      content={selectedNoteContent}
                      onUpdate={saveVaultNote}
                      placeholder="Write your note… Use [[Note Title]] for links."
                      className="h-full"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                      Create or select a note from the vault.
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-border/40 px-3 py-2">
                <div className="mx-auto w-full max-w-[806px]">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
                    <Network className="h-3.5 w-3.5" />
                    Knowledge Graph
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {vaultNotes.length} notes • {incomingBacklinks.length} backlinks into this note
                  </div>
                  {incomingBacklinks.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {incomingBacklinks.slice(0, 8).map((note) => (
                        <button
                          key={note.path}
                          onClick={() => setSelectedNotePath(note.path)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-foreground/80"
                        >
                          {note.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
