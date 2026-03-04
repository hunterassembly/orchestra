import * as React from 'react'
import { CalendarClock, CheckSquare2, User } from 'lucide-react'

type TaskSectionId = 'today' | 'upcoming' | 'anytime'

interface VaultTaskItem {
  id: string
  title: string
  status: TaskSectionId
  dueDate?: string
  assignee?: string
  description?: string
  notePath: string
  noteTitle: string
}

interface VaultTasksListPanelProps {
  workspaceRootPath: string | null
  vaultRootPath?: string | null
  section: TaskSectionId
  onOpenNote: (notePath: string) => void
  refreshToken?: number
}

function getAttr(attrs: string, key: string): string {
  const match = attrs.match(new RegExp(`${key}="([^"]*)"`, 'i'))
  return match?.[1] ?? ''
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function VaultTasksListPanel({ workspaceRootPath, vaultRootPath = null, section, onOpenNote, refreshToken = 0 }: VaultTasksListPanelProps) {
  const [tasks, setTasks] = React.useState<VaultTaskItem[]>([])
  const effectiveRootPath = React.useMemo(() => vaultRootPath || workspaceRootPath, [vaultRootPath, workspaceRootPath])
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

  const listMarkdownNotes = React.useCallback(async (dirPath: string): Promise<Array<{ path: string; relativePath: string; title: string }>> => {
    const entries = await window.electronAPI.getWorkspaceFiles(dirPath)
    const nested = await Promise.all(entries.map(async (entry) => {
      if (entry.type === 'directory') return listMarkdownNotes(entry.path)
      const lower = entry.name.toLowerCase()
      if (!lower.endsWith('.md') && !lower.endsWith('.markdown')) return []
      const relativePath = toRelativePath(entry.path)
      return [{
        path: entry.path,
        relativePath,
        title: entry.name.replace(/\.(md|markdown)$/i, ''),
      }]
    }))
    return nested.flat()
  }, [toRelativePath])

  const loadTasks = React.useCallback(async () => {
    if (!notesBasePath) {
      setTasks([])
      return
    }

    try {
      const notes = await listMarkdownNotes(notesBasePath)
      const parsed: VaultTaskItem[] = []

      await Promise.all(notes.map(async (note) => {
        const markdown = vaultRootPath
          ? await window.electronAPI.readVaultText(vaultRootPath, note.relativePath)
          : await window.electronAPI.readFile(note.path)
        const matches = markdown.matchAll(/<task-card([^>]*)>([\s\S]*?)<\/task-card>/gi)
        for (const match of matches) {
          const attrs = match[1] ?? ''
          const inner = match[2] ?? ''
          const statusRaw = (getAttr(attrs, 'status') || 'anytime').toLowerCase()
          const status: TaskSectionId = statusRaw === 'today' || statusRaw === 'upcoming' || statusRaw === 'anytime'
            ? statusRaw
            : 'anytime'
          parsed.push({
            id: `${note.relativePath}:${match.index ?? parsed.length}`,
            title: getAttr(attrs, 'title') || 'Untitled task',
            status,
            dueDate: getAttr(attrs, 'dueDate') || undefined,
            assignee: getAttr(attrs, 'assignee') || undefined,
            description: stripHtml(inner) || undefined,
            notePath: note.relativePath,
            noteTitle: note.title,
          })
        }
      }))

      const filtered = parsed
        .filter(task => task.status === section)
        .sort((a, b) => {
          if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
          return a.title.localeCompare(b.title)
        })

      setTasks(filtered)
    } catch {
      setTasks([])
    }
  }, [notesBasePath, section, listMarkdownNotes, vaultRootPath])

  React.useEffect(() => {
    const run = async () => {
      await loadTasks()
    }

    void run()
  }, [loadTasks, refreshToken])

  React.useEffect(() => {
    if (!notesBasePath || !effectiveRootPath) return

    const notesRoot = notesBasePath
    void window.electronAPI.watchWorkspaceFiles(notesRoot)
    const unsubscribe = window.electronAPI.onWorkspaceFilesChanged((changedPath) => {
      if (changedPath === notesRoot || changedPath === effectiveRootPath) {
        void loadTasks()
      }
    })

    return () => {
      unsubscribe()
      void window.electronAPI.unwatchWorkspaceFiles()
    }
  }, [notesBasePath, effectiveRootPath, loadTasks])

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="h-10 border-b border-border/40 px-3 flex items-center">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {section} Tasks
        </span>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-2">
        {tasks.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No tasks in {section}.
          </div>
        ) : (
          tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onOpenNote(task.notePath)}
              className="w-full text-left rounded-md px-2.5 py-2 hover:bg-sidebar-hover border border-border/30"
            >
              <div className="flex items-start gap-2">
                <CheckSquare2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{task.title}</div>
                  {task.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-1.5 text-[10px] text-muted-foreground">
                    {task.dueDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {task.dueDate}
                      </span>
                    )}
                    {task.assignee && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {task.assignee}
                      </span>
                    )}
                    <span>from {task.noteTitle}</span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
