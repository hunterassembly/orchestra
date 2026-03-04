import * as React from 'react'
import { FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { VaultNote } from './VaultNotesTypes'

export interface VaultNotesListPanelProps {
  workspaceId: string | null
  workspaceRootPath: string | null
  selectedNotePath: string | null
  onSelectNote: (notePath: string) => void
}

export function VaultNotesListPanel({
  workspaceId,
  workspaceRootPath,
  selectedNotePath,
  onSelectNote,
}: VaultNotesListPanelProps) {
  const [notes, setNotes] = React.useState<VaultNote[]>([])
  const notesRootPath = React.useMemo(() => {
    if (!workspaceRootPath) return null
    return `${workspaceRootPath.replace(/\/$/, '')}/notes`
  }, [workspaceRootPath])

  const listMarkdownNotes = React.useCallback(async (dirPath: string): Promise<VaultNote[]> => {
    const entries = await window.electronAPI.getWorkspaceFiles(dirPath)
    const nested = await Promise.all(entries.map(async (entry) => {
      if (entry.type === 'directory') return listMarkdownNotes(entry.path)
      const lower = entry.name.toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) return []
      const relativePath = workspaceRootPath
        ? entry.path.replace(`${workspaceRootPath}/`, '')
        : entry.path
      return [{
        id: entry.path,
        path: entry.path,
        relativePath,
        title: entry.name.replace(/\.(md|markdown)$/i, ''),
      }]
    }))
    return nested.flat()
  }, [workspaceRootPath])

  const loadNotes = React.useCallback(async () => {
    if (!notesRootPath) {
      setNotes([])
      return
    }
    try {
      const all = await listMarkdownNotes(notesRootPath)
      all.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      setNotes(all)
    } catch {
      setNotes([])
    }
  }, [listMarkdownNotes, notesRootPath])

  React.useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  const createNewNote = React.useCallback(async () => {
    if (!workspaceId || !workspaceRootPath) return
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const fileName = `note-${stamp}.md`
    const relativePath = `notes/${fileName}`
    const initial = `# ${fileName.replace(/\.md$/i, '')}\n\n`
    try {
      await window.electronAPI.writeWorkspaceText(workspaceId, relativePath, initial)
      await loadNotes()
      onSelectNote(relativePath)
      toast.success('Created new note')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create note'
      toast.error(message)
    }
  }, [workspaceId, workspaceRootPath, loadNotes, onSelectNote])

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
        {notes.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No notes yet</div>
        ) : (
          notes.map((note) => (
            <button
              key={note.path}
              onClick={() => onSelectNote(note.relativePath)}
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
  )
}

