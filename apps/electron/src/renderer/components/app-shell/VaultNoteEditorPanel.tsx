import * as React from 'react'
import { FileText, Network } from 'lucide-react'
import { toast } from 'sonner'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { TiptapMarkdownEditor } from '@craft-agent/ui'
import type { VaultNote } from './VaultNotesTypes'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '../../../shared/routes'
import {
  buildNoteMatchKeys,
  linkTargetMatchesNote,
  markdownLinksToWikiLinks,
  parseWikiLinks,
  resolveWikiTargetToRelativePath,
  wikiLinksToMarkdownLinks,
} from './VaultWikiLinks'

export interface VaultNoteEditorPanelProps {
  notePath: string | null
  onNoteSaved?: () => void
  vaultRootPath?: string | null
}

export function VaultNoteEditorPanel({ notePath, onNoteSaved, vaultRootPath = null }: VaultNoteEditorPanelProps) {
  const workspace = useActiveWorkspace()
  const { navigate } = useNavigation()
  const [vaultNotes, setVaultNotes] = React.useState<VaultNote[]>([])
  const [selectedNoteContent, setSelectedNoteContent] = React.useState('')
  const [isSavingNote, setIsSavingNote] = React.useState(false)
  const [incomingBacklinks, setIncomingBacklinks] = React.useState<VaultNote[]>([])
  const [outgoingLinks, setOutgoingLinks] = React.useState<string[]>([])
  const noteSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const effectiveRootPath = React.useMemo(() => vaultRootPath || workspace?.rootPath || null, [vaultRootPath, workspace?.rootPath])
  const notesBasePath = React.useMemo(() => {
    if (!effectiveRootPath) return null
    return vaultRootPath
      ? effectiveRootPath.replace(/\/$/, '')
      : `${effectiveRootPath.replace(/\/$/, '')}/notes`
  }, [effectiveRootPath, vaultRootPath])
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

  const selectedAbsolutePath = React.useMemo(() => {
    if (!effectiveRootPath || !notePath) return null
    return `${effectiveRootPath.replace(/\/$/, '')}/${notePath}`
  }, [effectiveRootPath, notePath])

  const slugifyTitle = React.useCallback((title: string): string => {
    return title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase()
      .slice(0, 120)
  }, [])

  const extractH1Title = React.useCallback((markdown: string): string | null => {
    const match = markdown.match(/^\s*#\s+(.+?)\s*$/m)
    if (!match?.[1]) return null
    const raw = match[1].trim()
    return raw.length > 0 ? raw : null
  }, [])

  const listMarkdownNotes = React.useCallback(async (dirPath: string): Promise<VaultNote[]> => {
    const entries = await window.electronAPI.getWorkspaceFiles(dirPath)
    const nested = await Promise.all(entries.map(async (entry) => {
      if (entry.type === 'directory') return listMarkdownNotes(entry.path)
      const lower = entry.name.toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) return []
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

  React.useEffect(() => {
    const run = async () => {
      if (!effectiveRootPath) {
        setVaultNotes([])
        return
      }
      try {
        if (!notesBasePath) {
          setVaultNotes([])
          return
        }
        const notes = await listMarkdownNotes(notesBasePath)
        notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        setVaultNotes(notes)
      } catch {
        setVaultNotes([])
      }
    }
    void run()
  }, [effectiveRootPath, notesBasePath, listMarkdownNotes, notePath])

  React.useEffect(() => {
    if (!selectedAbsolutePath) {
      setSelectedNoteContent('')
      setIncomingBacklinks([])
      setOutgoingLinks([])
      return
    }
    const readPromise = vaultRootPath
      ? (notePath ? window.electronAPI.readVaultText(vaultRootPath, notePath) : Promise.resolve(''))
      : window.electronAPI.readFile(selectedAbsolutePath)
    readPromise
      .then((content) => {
        const rawMarkdown = content || ''
        setSelectedNoteContent(wikiLinksToMarkdownLinks(rawMarkdown))
        const links = parseWikiLinks(rawMarkdown).map((link) => link.target)
        setOutgoingLinks(Array.from(new Set(links)))
      })
      .catch(() => {
        setSelectedNoteContent('')
        setOutgoingLinks([])
      })
  }, [selectedAbsolutePath, vaultRootPath, notePath])

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
    const selectedMatchKeys = buildNoteMatchKeys(selected.relativePath, selected.title)
    let cancelled = false
    ;(async () => {
      const linkedFrom: VaultNote[] = []
      await Promise.all(vaultNotes.map(async (note) => {
        if (note.path === selected.path) return
        try {
          const content = vaultRootPath
            ? await window.electronAPI.readVaultText(vaultRootPath, note.relativePath)
            : await window.electronAPI.readFile(note.path)
          const links = parseWikiLinks(content)
          const hasLink = links.some((link) => linkTargetMatchesNote(link.target, selectedMatchKeys))
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
  }, [selectedAbsolutePath, vaultNotes, vaultRootPath])

  const saveNote = React.useCallback((markdown: string) => {
    if (!notePath) return
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current)
    const rawMarkdown = markdownLinksToWikiLinks(markdown)
    const displayMarkdown = wikiLinksToMarkdownLinks(rawMarkdown)
    setSelectedNoteContent(displayMarkdown)
    const links = parseWikiLinks(rawMarkdown).map((link) => link.target)
    setOutgoingLinks(Array.from(new Set(links)))
    setIsSavingNote(true)
    noteSaveTimerRef.current = setTimeout(() => {
      const writePromise = vaultRootPath
        ? window.electronAPI.writeVaultText(vaultRootPath, notePath, rawMarkdown)
        : (workspace?.id
          ? window.electronAPI.writeWorkspaceText(workspace.id, notePath, rawMarkdown)
          : Promise.reject(new Error('Workspace not found for note write')))
      writePromise
        .then(async () => {
          const title = extractH1Title(rawMarkdown)
          if (title) {
            const titleSlug = slugifyTitle(title)
            if (titleSlug) {
              const parts = notePath.split('/')
              const fileName = parts.pop() || ''
              const dot = fileName.lastIndexOf('.')
              const currentBase = dot >= 0 ? fileName.slice(0, dot) : fileName
              const ext = dot >= 0 ? fileName.slice(dot) : '.md'

              if (titleSlug !== currentBase.toLowerCase()) {
                const dir = parts.join('/')
                const targetRel = dir ? `${dir}/${titleSlug}${ext}` : `${titleSlug}${ext}`
                const finalRel = vaultRootPath
                  ? await window.electronAPI.renameVaultText(vaultRootPath, notePath, targetRel)
                  : await window.electronAPI.renameWorkspaceText(workspace!.id, notePath, targetRel)
                if (finalRel !== notePath) {
                  navigate(routes.view.notes(finalRel))
                }
              }
            }
          }

          onNoteSaved?.()
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to save note'
          toast.error(message)
        })
        .finally(() => {
          setIsSavingNote(false)
          noteSaveTimerRef.current = null
        })
    }, 300)
  }, [workspace, notePath, extractH1Title, slugifyTitle, navigate, onNoteSaved, vaultRootPath])

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

  const wikiLinkSuggestions = React.useMemo(() => {
    const current = notePath || null
    return vaultNotes
      .filter((note) => note.relativePath !== current)
      .map((note) => ({
        label: note.title,
        value: note.relativePath.replace(/\.(md|markdown)$/i, ''),
        subtitle: note.relativePath,
      }))
      .sort((a, b) => a.subtitle.localeCompare(b.subtitle))
  }, [vaultNotes, notePath])

  if (!effectiveRootPath) {
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
          <div className="mx-auto w-full max-w-[806px] h-full">
            {notePath ? (
              <div className="h-full pt-[60px]">
                <TiptapMarkdownEditor
                  content={selectedNoteContent}
                  onUpdate={saveNote}
                  placeholder="Write your note… Use [[Note Title]] for links."
                  className="h-[calc(100%-60px)]"
                  wikiLinkSuggestions={wikiLinkSuggestions}
                  onWikiLinkNavigate={(target) => {
                    const rel = resolveWikiTargetToRelativePath(target, vaultNotes)
                    if (rel) navigate(routes.view.notes(rel))
                  }}
                />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground gap-2">
                <FileText className="h-4 w-4" />
                Create or select a note from the Notes list.
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
              {vaultNotes.length} notes • {incomingBacklinks.length} backlinks • {outgoingLinks.length} outgoing links
            </div>
            {outgoingLinks.length > 0 && (
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                Links to: {outgoingLinks.slice(0, 8).join(' • ')}
                {outgoingLinks.length > 8 ? ` • +${outgoingLinks.length - 8} more` : ''}
              </div>
            )}
            {incomingBacklinks.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {incomingBacklinks.slice(0, 10).map((note) => (
                  <button
                    type="button"
                    key={note.path}
                    onClick={() => navigate(routes.view.notes(note.relativePath))}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 hover:bg-muted/80 transition-colors cursor-pointer"
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
  )
}
