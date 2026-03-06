import * as React from 'react'
import { ChevronDown, ChevronRight, File, FileText, Folder, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface VaultTreeNode {
  id: string
  name: string
  path: string
  relativePath: string
  type: 'directory' | 'file'
  children?: VaultTreeNode[]
}

export interface VaultNotesListPanelProps {
  workspaceId: string | null
  workspaceRootPath: string | null
  vaultRootPath?: string | null
  selectedNotePath: string | null
  onSelectNote: (notePath: string) => void
}

export function VaultNotesListPanel({
  workspaceId,
  workspaceRootPath,
  vaultRootPath = null,
  selectedNotePath,
  onSelectNote,
}: VaultNotesListPanelProps) {
  const [tree, setTree] = React.useState<VaultTreeNode[]>([])
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const effectiveRootPath = React.useMemo(() => vaultRootPath || workspaceRootPath, [vaultRootPath, workspaceRootPath])
  const notesBasePath = React.useMemo(() => {
    if (!effectiveRootPath) return null
    return vaultRootPath
      ? effectiveRootPath.replace(/\/$/, '')
      : `${effectiveRootPath.replace(/\/$/, '')}/notes`
  }, [effectiveRootPath, vaultRootPath])
  const notesRootPath = React.useMemo(() => {
    return notesBasePath
  }, [notesBasePath])
  const toRelativePath = React.useCallback((absolutePath: string): string => {
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

  const listTreeNodes = React.useCallback(async (dirPath: string): Promise<VaultTreeNode[]> => {
    const entries = await window.electronAPI.getWorkspaceFiles(dirPath)
    const mapped = await Promise.all(entries.map(async (entry) => {
      // Hide hidden/system files and folders (e.g. .obsidian, .space, .makemd)
      if (entry.name.startsWith('.')) return null

      const relativePath = toRelativePath(entry.path)
      if (entry.type === 'directory') {
        const children = await listTreeNodes(entry.path)
        // Hide empty folders (only keep folders with note-relevant descendants)
        if (children.length === 0) return null
        return {
          id: entry.path,
          name: entry.name,
          path: entry.path,
          relativePath,
          type: 'directory' as const,
          children,
        }
      }
      const lower = entry.name.toLowerCase()
      // Only show markdown notes in the notes tree
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown') && !lower.endsWith('.mdc')) {
        return null
      }
      return {
        id: entry.path,
        name: entry.name,
        path: entry.path,
        relativePath,
        type: 'file' as const,
      }
    }))
    const filtered: VaultTreeNode[] = mapped.flatMap(node => (node ? [node] : []))
    return filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }, [toRelativePath])

  const loadNotesTree = React.useCallback(async () => {
    if (!notesRootPath) {
      setTree([])
      return
    }
    try {
      const nodes = await listTreeNodes(notesRootPath)
      setTree(nodes)
      // Keep folders collapsed by default; preserve any user-expanded state.
      setExpanded((prev) => prev)
    } catch {
      setTree([])
    }
  }, [listTreeNodes, notesRootPath])

  React.useEffect(() => {
    void loadNotesTree()
  }, [loadNotesTree])

  const createNewNote = React.useCallback(async () => {
    if (!effectiveRootPath) return
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const fileName = `note-${stamp}.md`
    const relativePath = vaultRootPath ? fileName : `notes/${fileName}`
    const initial = `# ${fileName.replace(/\.md$/i, '')}\n\n`
    try {
      if (vaultRootPath) {
        await window.electronAPI.writeVaultText(vaultRootPath, relativePath, initial)
      } else if (workspaceId) {
        await window.electronAPI.writeWorkspaceText(workspaceId, relativePath, initial)
      } else {
        throw new Error('Workspace not available for note creation')
      }
      await loadNotesTree()
      onSelectNote(relativePath)
      toast.success('Created new note')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create note'
      toast.error(message)
    }
  }, [workspaceId, effectiveRootPath, vaultRootPath, loadNotesTree, onSelectNote])

  const toggleExpanded = React.useCallback((relativePath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relativePath)) next.delete(relativePath)
      else next.add(relativePath)
      return next
    })
  }, [])

  const isMarkdownFile = React.useCallback((name: string) => {
    const lower = name.toLowerCase()
    return lower.endsWith('.md') || lower.endsWith('.markdown')
  }, [])

  const renderNode = React.useCallback((node: VaultTreeNode, depth: number) => {
    if (node.type === 'directory') {
      const isOpen = expanded.has(node.relativePath)
      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => toggleExpanded(node.relativePath)}
            className="w-full text-left rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-sidebar-hover text-foreground/90"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            title={node.relativePath}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{node.name}</span>
            </div>
          </button>
          {isOpen && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const markdown = isMarkdownFile(node.name)
    const title = node.name.replace(/\.(md|markdown)$/i, '')
    return (
      <button
        key={node.path}
        onClick={() => {
          if (markdown) onSelectNote(node.relativePath)
          else toast.info('Only markdown files open in Notes editor')
        }}
        className={cn(
          'w-full text-left rounded-md px-2 py-1.5 text-sm cursor-pointer',
          selectedNotePath === node.relativePath ? 'bg-muted text-foreground' : 'text-foreground/80 hover:bg-sidebar-hover',
          !markdown && 'opacity-70',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={node.relativePath}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {markdown ? (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{markdown ? title : node.name}</span>
        </div>
      </button>
    )
  }, [expanded, toggleExpanded, isMarkdownFile, onSelectNote, selectedNotePath])

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-10 border-b border-border/40 px-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</span>
        <button
          type="button"
          onClick={createNewNote}
          className="h-7 w-7 rounded-md hover:bg-muted inline-flex items-center justify-center text-muted-foreground"
          title="Create note"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {tree.length === 0 ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">No notes yet</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  )
}
