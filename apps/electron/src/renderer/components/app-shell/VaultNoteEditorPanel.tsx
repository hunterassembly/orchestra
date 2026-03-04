import * as React from 'react'
import { FileText, Network } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { TiptapMarkdownEditor } from '@craft-agent/ui'
import type { VaultNote } from './VaultNotesTypes'

export interface VaultNoteEditorPanelProps {
  notePath: string | null
}

export function VaultNoteEditorPanel({ notePath }: VaultNoteEditorPanelProps) {
  const workspace = useActiveWorkspace()
  const [vaultNotes, setVaultNotes] = React.useState<VaultNote[]>([])
  const [selectedNoteContent, setSelectedNoteContent] = React.useState('')
  const [isSavingNote, setIsSavingNote] = React.useState(false)
  const [incomingBacklinks, setIncomingBacklinks] = React.useState<VaultNote[]>([])
  const noteSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedAbsolutePath = React.useMemo(() => {
    if (!workspace?.rootPath || !notePath) return null
    return `${workspace.rootPath.replace(/\/$/, '')}/${notePath}`
  }, [workspace?.rootPath, notePath])

  const listMarkdownNotes = React.useCallback(async (dirPath: string): Promise<VaultNote[]> => {
    const entries = await window.electronAPI.getWorkspaceFiles(dirPath)
    const nested = await Promise.all(entries.map(async (entry) => {
      if (entry.type === 'directory') return listMarkdownNotes(entry.path)
      const lower = entry.name.toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) return []
      const relativePath = workspace?.rootPath ? entry.path.replace(`${workspace.rootPath}/`, '') : entry.path
      return [{
        id: entry.path,
        path: entry.path,
        relativePath,
        title: entry.name.replace(/\.(md|markdown)$/i, ''),
      }]
    }))
    return nested.flat()
  }, [workspace?.rootPath])

  React.useEffect(() => {
    const run = async () => {
      if (!workspace?.rootPath) {
        setVaultNotes([])
        return
      }
      try {
        const notes = await listMarkdownNotes(`${workspace.rootPath.replace(/\/$/, '')}/notes`)
        notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        setVaultNotes(notes)
      } catch {
        setVaultNotes([])
      }
    }
    void run()
  }, [workspace?.rootPath, listMarkdownNotes, notePath])

  React.useEffect(() => {
    if (!selectedAbsolutePath) {
      setSelectedNoteContent('')
      setIncomingBacklinks([])
      return
    }
    window.electronAPI.readFile(selectedAbsolutePath)
      .then((content) => setSelectedNoteContent(content || ''))
      .catch(() => setSelectedNoteContent(''))
  }, [selectedAbsolutePath])

  React.useEffect(() => {
    if (!selectedAbsolutePath || vaultNotes.length === 0) {
      setIncomingBacklinks([])
      return
    }
    const selected = vaultNotes.find(n => n.path === selectedAbsolutePath)
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
          const content = await window.electronAPI.readFile(note.path)
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
  }, [selectedAbsolutePath, vaultNotes])

  const saveNote = React.useCallback((markdown: string) => {
    if (!workspace?.id || !notePath) return
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current)
    setSelectedNoteContent(markdown)
    setIsSavingNote(true)
    noteSaveTimerRef.current = setTimeout(() => {
      window.electronAPI.writeWorkspaceText(workspace.id, notePath, markdown)
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to save note'
          toast.error(message)
        })
        .finally(() => {
          setIsSavingNote(false)
          noteSaveTimerRef.current = null
        })
    }, 300)
  }, [workspace?.id, notePath])

  React.useEffect(() => {
    return () => {
      if (noteSaveTimerRef.current) {
        clearTimeout(noteSaveTimerRef.current)
        noteSaveTimerRef.current = null
      }
    }
  }, [])

  const selectedTitle = React.useMemo(() => {
    if (!notePath) return null
    return vaultNotes.find(n => n.relativePath === notePath)?.title ?? notePath.split('/').pop()?.replace(/\.(md|markdown)$/i, '') ?? notePath
  }, [notePath, vaultNotes])

  if (!workspace?.rootPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p className="text-sm">No workspace selected</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="h-10 px-3 border-b border-border/40 flex items-center justify-between">
        <div className="min-w-0 text-xs font-medium truncate">
          {selectedTitle || 'Select a note'}
        </div>
        <div className="text-[10px] text-muted-foreground">{isSavingNote ? 'Saving…' : ''}</div>
      </div>
      <div className="flex-1 min-h-0 grid grid-rows-[1fr_auto]">
        <div className="min-h-0 overflow-auto px-3 py-2">
          {notePath ? (
            <TiptapMarkdownEditor
              content={selectedNoteContent}
              onUpdate={saveNote}
              placeholder="Write your note… Use [[Note Title]] for links."
              className="h-full"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground gap-2">
              <FileText className="h-4 w-4" />
              Create or select a note from the Notes list.
            </div>
          )}
        </div>
        <div className="border-t border-border/40 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
            <Network className="h-3.5 w-3.5" />
            Knowledge Graph
          </div>
          <div className="text-xs text-muted-foreground">
            {vaultNotes.length} notes • {incomingBacklinks.length} backlinks into this note
          </div>
          {incomingBacklinks.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {incomingBacklinks.slice(0, 10).map((note) => (
                <span
                  key={note.path}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80"
                >
                  {note.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
