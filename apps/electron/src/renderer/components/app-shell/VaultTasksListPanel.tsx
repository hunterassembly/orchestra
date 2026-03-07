import * as React from 'react'
import { CalendarClock, CheckSquare2, User } from 'lucide-react'
import {
  getNotesBasePath,
  loadWaveOneTasks,
  type WaveOneTaskItem,
  type WaveOneTaskSection,
} from './wave-one-indexing'

interface VaultTasksListPanelProps {
  workspaceRootPath: string | null
  vaultRootPath?: string | null
  section: WaveOneTaskSection
  onOpenNote: (notePath: string) => void
  refreshToken?: number
}

export function VaultTasksListPanel({ workspaceRootPath, vaultRootPath = null, section, onOpenNote, refreshToken = 0 }: VaultTasksListPanelProps) {
  const [tasks, setTasks] = React.useState<WaveOneTaskItem[]>([])
  const effectiveRootPath = React.useMemo(() => vaultRootPath || workspaceRootPath, [vaultRootPath, workspaceRootPath])
  const notesBasePath = React.useMemo(
    () => getNotesBasePath(workspaceRootPath, vaultRootPath),
    [workspaceRootPath, vaultRootPath],
  )

  const loadTasks = React.useCallback(async () => {
    if (!notesBasePath) {
      setTasks([])
      return
    }

    try {
      const filtered = (await loadWaveOneTasks(workspaceRootPath, vaultRootPath))
        .filter(task => task.status === section)

      setTasks(filtered)
    } catch {
      setTasks([])
    }
  }, [notesBasePath, section, workspaceRootPath, vaultRootPath])

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
