import * as React from 'react'
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  FileText,
  FolderKanban,
  FolderOpen,
  ListTodo,
  MessagesSquare,
  NotebookTabs,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { VaultNoteEditorPanel } from './VaultNoteEditorPanel'
import type { SessionMeta } from '@/atoms/sessions'
import {
  filterTasksForProject,
  loadWaveOneTasks,
  stripNoteExtension,
  type WaveOneTaskItem,
  type WaveOneTaskSection,
} from './wave-one-indexing'
import {
  resolveWaveOneProject,
  useWaveOneProjects,
  type BenjiProjectRecord,
} from './wave-one-projects'

type BenjiSurfaceKind = 'agent' | 'projects' | 'tasks' | 'notes' | 'threads' | 'queue'

interface SurfaceCopy {
  eyebrow: string
  title: string
  body: string
  checkpoints: string[]
}

interface BenjiMetric {
  label: string
  value: string
  hint?: string
}

interface BenjiAction {
  label: string
  description: string
  onClick: () => void
}

interface BenjiSignal {
  label: string
  value: string
}

export type WaveOneProjectEntry = BenjiProjectRecord

interface ProjectThreadEntry {
  sessionId: string
  title: string
  preview: string
  status: string
  hasUnread: boolean
  isFlagged: boolean
  lastMessageAt: number
  score: number
}

interface AgentProjectSummary {
  project: WaveOneProjectEntry
  reviewCount: number
  unreadCount: number
  activeCount: number
  todayTaskCount: number
  taskCount: number
  lastActivityAt: number
  activityScore: number
}

const SURFACE_COPY: Record<BenjiSurfaceKind, SurfaceCopy> = {
  agent: {
    eyebrow: 'Wave 1',
    title: 'Agent is the command surface',
    body: 'Open Benji and orient instantly around momentum, review, and what to push next.',
    checkpoints: [
      'Bring active work, blocked work, and review items into one home surface.',
      'Keep the next best action obvious instead of burying it in session history.',
      'Make Claw feel like the operating layer of the product.',
    ],
  },
  projects: {
    eyebrow: 'Wave 1',
    title: 'Projects become canvases',
    body: 'Projects shift from containers to living workbenches where notes, tasks, runs, and judgment sit together.',
    checkpoints: [
      'Land in a project canvas instead of a disconnected detail page.',
      'Keep the project note central so work feels grounded and reviewable.',
      'Attach thread and run context where the decision is being made.',
    ],
  },
  tasks: {
    eyebrow: 'Wave 1',
    title: 'Tasks stay close to the work',
    body: 'The task surface should show what needs attention now, while keeping the underlying note one click away.',
    checkpoints: [
      'Separate task review from the generic notes view.',
      'Preserve note-backed workflows so nothing gets stranded during migration.',
      'Give the user a clearer queue of today, upcoming, and anytime work.',
    ],
  },
  notes: {
    eyebrow: 'Wave 1',
    title: 'Notes remain the durable memory',
    body: 'Notes continue to anchor project thinking, with the shell around them becoming more Benji-native.',
    checkpoints: [
      'Keep notes editable and close to project context.',
      'Let tasks and threads point back into notes instead of replacing them.',
      'Preserve the vault as the durable source of truth.',
    ],
  },
  threads: {
    eyebrow: 'Wave 1',
    title: 'Threads surface existing runtime history',
    body: 'Wave 1 re-frames Craft sessions as Benji threads so existing work remains available in the new mental model.',
    checkpoints: [
      'Expose current thread history without forcing users to think in Craft terms.',
      'Keep selection, unread state, and session detail behavior intact during the migration.',
      'Set up a clean path for project-context thread rendering later.',
    ],
  },
  queue: {
    eyebrow: 'Wave 1',
    title: 'Queue becomes the review lane',
    body: 'Queue will collect what needs judgment, follow-up, or routing so momentum is not lost between runs.',
    checkpoints: [
      'Create one place for review, blocked work, and follow-up items.',
      'Reduce the amount of hunting across notes and threads.',
      'Prepare the shell for richer orchestration and review flows.',
    ],
  },
}

const SURFACE_ICONS: Record<BenjiSurfaceKind, typeof Bot> = {
  agent: Bot,
  projects: FolderKanban,
  tasks: ListTodo,
  notes: FileText,
  threads: MessagesSquare,
  queue: BriefcaseBusiness,
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/ -]+/g, ' ')
}

function tokenizeProjectTerms(project: WaveOneProjectEntry): string[] {
  const rawParts = [
    project.title,
    project.rootPath,
    project.primaryNotePath ?? '',
  ]

  const terms = new Set<string>()
  for (const part of rawParts) {
    const normalized = normalizeForMatch(stripNoteExtension(part))
    for (const token of normalized.split(/[\/\s-]+/)) {
      if (token.length >= 3) {
        terms.add(token)
      }
    }
  }

  return Array.from(terms)
}

function deriveProjectThreads(project: WaveOneProjectEntry, sessions: SessionMeta[]): ProjectThreadEntry[] {
  const normalizedProjectPath = normalizeForMatch(project.rootPath)
  const normalizedNotePath = normalizeForMatch(project.primaryNotePath ?? '')
  const normalizedProjectTitle = normalizeForMatch(project.title)
  const projectTerms = tokenizeProjectTerms(project)

  return sessions
    .flatMap((session) => {
      if (session.hidden || session.isArchived) return []

      const text = normalizeForMatch([
        session.name ?? '',
        session.preview ?? '',
        session.workingDirectory ?? '',
      ].join(' '))

      let score = 0
      if (normalizedProjectTitle && text.includes(normalizedProjectTitle)) score += 6
      if (normalizedProjectPath && text.includes(normalizedProjectPath)) score += 8
      if (normalizedNotePath && text.includes(normalizedNotePath)) score += 8

      const matchedTerms = projectTerms.filter(term => text.includes(term))
      score += matchedTerms.length * 2

      if (score === 0) return []

      return [{
        sessionId: session.id,
        title: session.name || session.preview || session.id,
        preview: session.preview || 'No preview available yet',
        status: session.sessionStatus || 'todo',
        hasUnread: session.hasUnread === true,
        isFlagged: session.isFlagged === true,
        lastMessageAt: session.lastMessageAt ?? 0,
        score,
      }]
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.lastMessageAt - a.lastMessageAt
    })
}

function formatThreadDate(timestamp: number): string {
  if (!timestamp) return 'No recent activity'
  return new Date(timestamp).toLocaleDateString()
}

function useWaveOneTasks(workspaceRootPath?: string | null, vaultRootPath?: string | null) {
  const [tasks, setTasks] = React.useState<WaveOneTaskItem[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    async function run() {
      setIsLoading(true)
      try {
        const next = await loadWaveOneTasks(workspaceRootPath, vaultRootPath)
        if (!cancelled) {
          setTasks(next)
        }
      } catch {
        if (!cancelled) {
          setTasks([])
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [workspaceRootPath, vaultRootPath])

  return { tasks, isLoading }
}

function formatTaskSection(section: WaveOneTaskSection): string {
  if (section === 'today') return 'Today'
  if (section === 'upcoming') return 'Upcoming'
  return 'Anytime'
}

function formatTaskDueDate(dueDate?: string): string {
  if (!dueDate) return 'No due date'
  return dueDate
}

function sortQueueThreads(a: ProjectThreadEntry, b: ProjectThreadEntry): number {
  const score = (thread: ProjectThreadEntry) => (
    (thread.status === 'needs-review' ? 4 : 0)
    + (thread.isFlagged ? 2 : 0)
    + (thread.hasUnread ? 1 : 0)
  )

  const diff = score(b) - score(a)
  if (diff !== 0) return diff
  return b.lastMessageAt - a.lastMessageAt
}

function deriveReviewThreads(sessions: SessionMeta[]): ProjectThreadEntry[] {
  return sessions
    .filter(session => !session.hidden && session.isArchived !== true)
    .map(session => ({
      sessionId: session.id,
      title: session.name || session.preview || session.id,
      preview: session.preview || 'No preview available yet',
      status: session.sessionStatus || 'todo',
      hasUnread: session.hasUnread === true,
      isFlagged: session.isFlagged === true,
      lastMessageAt: session.lastMessageAt ?? 0,
      score: 0,
    }))
    .filter(thread => thread.status === 'needs-review' || thread.hasUnread || thread.isFlagged)
    .sort(sortQueueThreads)
}

function deriveAgentProjectSummaries(
  projects: WaveOneProjectEntry[],
  sessions: SessionMeta[],
  tasks: WaveOneTaskItem[],
): AgentProjectSummary[] {
  return projects
    .map(project => {
      const projectThreads = deriveProjectThreads(project, sessions)
      const projectTasks = filterTasksForProject(project, tasks)
      const reviewCount = projectThreads.filter(thread => thread.status === 'needs-review').length
      const unreadCount = projectThreads.filter(thread => thread.hasUnread).length
      const activeCount = projectThreads.filter(thread => thread.status === 'in-progress').length
      const todayTaskCount = projectTasks.filter(task => task.status === 'today').length
      const lastActivityAt = projectThreads[0]?.lastMessageAt ?? 0
      const activityScore =
        (reviewCount * 5)
        + (unreadCount * 3)
        + (activeCount * 3)
        + (todayTaskCount * 2)
        + Math.min(projectTasks.length, 4)

      return {
        project,
        reviewCount,
        unreadCount,
        activeCount,
        todayTaskCount,
        taskCount: projectTasks.length,
        lastActivityAt,
        activityScore,
      }
    })
    .filter(summary => summary.activityScore > 0)
    .sort((a, b) => {
      if (b.activityScore !== a.activityScore) return b.activityScore - a.activityScore
      return b.lastActivityAt - a.lastActivityAt
    })
}

function TaskListCard({
  title,
  subtitle,
  tasks,
  emptyMessage,
  onOpenTask,
}: {
  title: string
  subtitle: string
  tasks: WaveOneTaskItem[]
  emptyMessage: string
  onOpenTask: (task: WaveOneTaskItem) => void
}) {
  return (
    <div className="rounded-[18px] border border-border/50 bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">{title}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{subtitle}</div>
        </div>
        <div className="text-xs text-muted-foreground">{tasks.length} surfaced</div>
      </div>
      <div className="mt-3 space-y-2">
        {tasks.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border/40 px-3 py-4 text-sm leading-6 text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          tasks.map(task => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpenTask(task)}
              className="w-full rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-left transition-colors hover:bg-background"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{task.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {task.noteTitle} · {formatTaskSection(task.status)}
                  </div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              {task.description ? (
                <div className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {task.description}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" />
                  {formatTaskDueDate(task.dueDate)}
                </span>
                {task.assignee ? (
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {task.assignee}
                  </span>
                ) : null}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function ThreadListCard({
  title,
  subtitle,
  threads,
  emptyMessage,
  onOpenThread,
}: {
  title: string
  subtitle: string
  threads: ProjectThreadEntry[]
  emptyMessage: string
  onOpenThread: (sessionId: string) => void
}) {
  return (
    <div className="rounded-[18px] border border-border/50 bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">{title}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{subtitle}</div>
        </div>
        <div className="text-xs text-muted-foreground">{threads.length} surfaced</div>
      </div>
      <div className="mt-3 space-y-2">
        {threads.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border/40 px-3 py-4 text-sm leading-6 text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          threads.map(thread => (
            <button
              key={thread.sessionId}
              type="button"
              onClick={() => onOpenThread(thread.sessionId)}
              className="w-full rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-left transition-colors hover:bg-background"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{thread.title}</div>
                  <div className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{thread.preview}</div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Status: {thread.status}</span>
                {thread.hasUnread ? <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">Unread</span> : null}
                {thread.isFlagged ? <span className="rounded-full bg-background px-2 py-0.5">Flagged</span> : null}
                <span>{formatThreadDate(thread.lastMessageAt)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function ProjectSummaryCard({
  summaries,
  title,
  subtitle,
  emptyMessage,
  onOpenProject,
}: {
  summaries: AgentProjectSummary[]
  title: string
  subtitle: string
  emptyMessage: string
  onOpenProject: (projectId: string) => void
}) {
  return (
    <div className="rounded-[18px] border border-border/50 bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">{title}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{subtitle}</div>
        </div>
        <div className="text-xs text-muted-foreground">{summaries.length} surfaced</div>
      </div>
      <div className="mt-3 space-y-2">
        {summaries.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border/40 px-3 py-4 text-sm leading-6 text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          summaries.map(summary => (
            <button
              key={summary.project.id}
              type="button"
              onClick={() => onOpenProject(summary.project.id)}
              className="w-full rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-left transition-colors hover:bg-background"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{summary.project.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {summary.project.rootPath}
                  </div>
                </div>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{summary.activeCount} active</span>
                <span>{summary.reviewCount} review</span>
                <span>{summary.unreadCount} unread</span>
                <span>{summary.todayTaskCount} today</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function SurfaceCard({
  kind,
  compact = false,
  selectedId,
  metrics,
  actions,
  signals,
}: {
  kind: BenjiSurfaceKind
  compact?: boolean
  selectedId?: string | null
  metrics?: BenjiMetric[]
  actions?: BenjiAction[]
  signals?: BenjiSignal[]
}) {
  const copy = SURFACE_COPY[kind]
  const Icon = SURFACE_ICONS[kind]

  return (
    <div className="flex h-full flex-col rounded-[18px] border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
            {copy.eyebrow}
          </div>
          <h2 className={compact ? 'mt-2 text-base font-medium text-foreground' : 'mt-2 text-2xl font-medium text-foreground'}>
            {copy.title}
          </h2>
        </div>
        <div className="rounded-[14px] border border-border/40 bg-background/70 p-2.5 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={compact ? 'mt-3 text-sm leading-6 text-muted-foreground' : 'mt-4 max-w-2xl text-sm leading-7 text-muted-foreground'}>
        {copy.body}
      </p>
      {selectedId ? (
        <div className="mt-4 rounded-[14px] border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">
          Selected: <span className="font-medium">{selectedId}</span>
        </div>
      ) : null}
      {metrics && metrics.length > 0 ? (
        <div className={compact ? 'mt-4 grid gap-2' : 'mt-6 grid gap-3 md:grid-cols-3'}>
          {metrics.map(metric => (
            <div key={metric.label} className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">{metric.label}</div>
              <div className="mt-2 text-2xl font-medium text-foreground">{metric.value}</div>
              {metric.hint ? (
                <div className="mt-1 text-xs text-muted-foreground">{metric.hint}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {actions && actions.length > 0 ? (
        <div className={compact ? 'mt-4 space-y-2' : 'mt-6 grid gap-3 md:grid-cols-2'}>
          {actions.map(action => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="group rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-left transition-colors hover:bg-background"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">{action.label}</div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-1 text-sm leading-6 text-muted-foreground">{action.description}</div>
            </button>
          ))}
        </div>
      ) : null}
      {signals && signals.length > 0 ? (
        <div className="mt-6 rounded-[16px] border border-border/40 bg-background/50">
          {signals.map(signal => (
            <div
              key={signal.label}
              className="flex items-center justify-between gap-4 border-b border-border/30 px-4 py-3 last:border-b-0"
            >
              <div className="text-sm text-muted-foreground">{signal.label}</div>
              <div className="text-sm font-medium text-foreground">{signal.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className={compact ? 'mt-4 space-y-2' : 'mt-6 grid gap-3 md:grid-cols-3'}>
        {copy.checkpoints.map(checkpoint => (
          <div
            key={checkpoint}
            className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-sm leading-6 text-muted-foreground"
          >
            {checkpoint}
          </div>
        ))}
      </div>
    </div>
  )
}

export function BenjiNavigatorPanel({
  kind,
  selectedId,
  metrics,
}: {
  kind: BenjiSurfaceKind
  selectedId?: string | null
  metrics?: BenjiMetric[]
}) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <SurfaceCard kind={kind} compact selectedId={selectedId} metrics={metrics} />
    </div>
  )
}

export function BenjiMainSurface({
  kind,
  selectedId,
  metrics,
  actions,
  signals,
}: {
  kind: BenjiSurfaceKind
  selectedId?: string | null
  metrics?: BenjiMetric[]
  actions?: BenjiAction[]
  signals?: BenjiSignal[]
}) {
  return (
    <div className="h-full overflow-y-auto p-5">
      <SurfaceCard kind={kind} selectedId={selectedId} metrics={metrics} actions={actions} signals={signals} />
    </div>
  )
}

export function BenjiAgentSurface({
  workspaceId,
  workspaceRootPath,
  vaultRootPath,
  sessions,
  onOpenQueue,
  onOpenTasks,
  onOpenThread,
  onOpenTask,
  onOpenProject,
  automationCount,
}: {
  workspaceId?: string | null
  workspaceRootPath?: string | null
  vaultRootPath?: string | null
  sessions: SessionMeta[]
  onOpenQueue: () => void
  onOpenTasks: () => void
  onOpenThread: (sessionId: string) => void
  onOpenTask: (task: WaveOneTaskItem) => void
  onOpenProject: (projectId: string) => void
  automationCount: number
}) {
  const { projects, isLoading: projectsLoading } = useWaveOneProjects(workspaceId, workspaceRootPath, vaultRootPath)
  const { tasks, isLoading: tasksLoading } = useWaveOneTasks(workspaceRootPath, vaultRootPath)
  const reviewThreads = React.useMemo(
    () => deriveReviewThreads(sessions).slice(0, 6),
    [sessions],
  )
  const todayTasks = React.useMemo(
    () => tasks.filter(task => task.status === 'today').slice(0, 6),
    [tasks],
  )
  const recentProjects = React.useMemo(
    () => deriveAgentProjectSummaries(projects, sessions, tasks).slice(0, 6),
    [projects, sessions, tasks],
  )
  const activeThreadCount = React.useMemo(
    () => sessions.filter(meta => meta.isArchived !== true).length,
    [sessions],
  )
  const inProgressCount = React.useMemo(
    () => sessions.filter(meta => meta.isArchived !== true && (meta.sessionStatus || 'todo') === 'in-progress').length,
    [sessions],
  )
  const needsReviewCount = React.useMemo(
    () => sessions.filter(meta => meta.isArchived !== true && (meta.sessionStatus || 'todo') === 'needs-review').length,
    [sessions],
  )
  const unreadCount = React.useMemo(
    () => sessions.filter(meta => meta.isArchived !== true && meta.hasUnread).length,
    [sessions],
  )
  const topProject = recentProjects[0]?.project ?? null
  const topTask = todayTasks[0] ?? null
  const isLoading = projectsLoading || tasksLoading

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading agent home…
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="space-y-4">
        <SurfaceCard
          kind="agent"
          metrics={[
            { label: 'Active threads', value: String(activeThreadCount), hint: 'Current live work across the workspace' },
            { label: 'Needs review', value: String(needsReviewCount), hint: 'Judgment waiting on you right now' },
            { label: 'Today tasks', value: String(todayTasks.length), hint: 'Execution work already grounded in notes' },
          ]}
          actions={[
            {
              label: topProject ? `Open ${topProject.title}` : 'Open queue',
              description: topProject
                ? 'Jump into the hottest active project instead of orienting from scratch.'
                : 'Start from the review lane and clear what needs judgment first.',
              onClick: () => topProject ? onOpenProject(topProject.id) : onOpenQueue(),
            },
            {
              label: topTask ? `Continue ${topTask.title}` : 'Open tasks',
              description: topTask
                ? 'Go straight to the next note-backed task in today’s lane.'
                : 'Move into the task lane and pick the next execution item.',
              onClick: () => topTask ? onOpenTask(topTask) : onOpenTasks(),
            },
            {
              label: 'Open queue',
              description: 'Review new agent work, unread updates, and follow-up items in one place.',
              onClick: onOpenQueue,
            },
          ]}
          signals={[
            { label: 'Unread updates', value: String(unreadCount) },
            { label: 'Active runs', value: String(inProgressCount) },
            { label: 'Recently active projects', value: String(recentProjects.length) },
            { label: 'Automations available', value: String(automationCount) },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-3">
          <ThreadListCard
            title="Needs your judgment"
            subtitle="Threads that most likely require taste, review, or a decision"
            threads={reviewThreads}
            emptyMessage="No thread is explicitly waiting on judgment right now."
            onOpenThread={onOpenThread}
          />
          <TaskListCard
            title="Ready to execute"
            subtitle="Today-lane tasks you can push forward immediately"
            tasks={todayTasks}
            emptyMessage="No today tasks are indexed yet. Promote note tasks into the Today lane to make the next action obvious."
            onOpenTask={onOpenTask}
          />
          <ProjectSummaryCard
            title="Recently active projects"
            subtitle="Where momentum is already accumulating"
            summaries={recentProjects}
            emptyMessage="As projects gather task and thread activity, they will rise to the top here."
            onOpenProject={onOpenProject}
          />
        </div>
      </div>
    </div>
  )
}

export function BenjiTasksSurface({
  workspaceRootPath,
  vaultRootPath,
  section,
  onOpenTask,
  onOpenQueue,
}: {
  workspaceRootPath?: string | null
  vaultRootPath?: string | null
  section: WaveOneTaskSection
  onOpenTask: (task: WaveOneTaskItem) => void
  onOpenQueue: () => void
}) {
  const { tasks, isLoading } = useWaveOneTasks(workspaceRootPath, vaultRootPath)
  const tasksInSection = React.useMemo(
    () => tasks.filter(task => task.status === section),
    [tasks, section],
  )
  const sectionCounts = React.useMemo(() => ({
    today: tasks.filter(task => task.status === 'today').length,
    upcoming: tasks.filter(task => task.status === 'upcoming').length,
    anytime: tasks.filter(task => task.status === 'anytime').length,
  }), [tasks])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading tasks…
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="space-y-4">
        <SurfaceCard
          kind="tasks"
          metrics={[
            { label: 'Today', value: String(sectionCounts.today), hint: 'Immediate note-backed work' },
            { label: 'Upcoming', value: String(sectionCounts.upcoming), hint: 'Queued next-pass tasks' },
            { label: 'Anytime', value: String(sectionCounts.anytime), hint: 'Open-ended backlog items' },
          ]}
          actions={[
            {
              label: 'Open queue',
              description: 'Move from task execution back into review and follow-up work.',
              onClick: onOpenQueue,
            },
          ]}
          signals={[
            { label: 'Current section', value: formatTaskSection(section) },
            { label: 'Tasks in view', value: String(tasksInSection.length) },
          ]}
        />
        <TaskListCard
          title={`${formatTaskSection(section)} lane`}
          subtitle="Choose a task note and continue from the source document"
          tasks={tasksInSection.slice(0, 12)}
          emptyMessage={`No ${section} tasks are indexed yet. Add <task-card> blocks to your notes and they will show up here.`}
          onOpenTask={onOpenTask}
        />
      </div>
    </div>
  )
}

export function BenjiQueueSurface({
  workspaceRootPath,
  vaultRootPath,
  sessions,
  onOpenThread,
  onOpenTask,
  onOpenTasks,
}: {
  workspaceRootPath?: string | null
  vaultRootPath?: string | null
  sessions: SessionMeta[]
  onOpenThread: (sessionId: string) => void
  onOpenTask: (task: WaveOneTaskItem) => void
  onOpenTasks: () => void
}) {
  const { tasks, isLoading } = useWaveOneTasks(workspaceRootPath, vaultRootPath)
  const queueThreads = React.useMemo(() => {
    const scoped = sessions
      .filter(session => !session.hidden && session.isArchived !== true)
      .map(session => ({
        sessionId: session.id,
        title: session.name || session.preview || session.id,
        preview: session.preview || 'No preview available yet',
        status: session.sessionStatus || 'todo',
        hasUnread: session.hasUnread === true,
        isFlagged: session.isFlagged === true,
        lastMessageAt: session.lastMessageAt ?? 0,
        score: 0,
      }))
      .filter(thread => thread.status === 'needs-review' || thread.hasUnread || thread.isFlagged)

    return scoped.sort(sortQueueThreads).slice(0, 8)
  }, [sessions])
  const todayTasks = React.useMemo(
    () => tasks.filter(task => task.status === 'today').slice(0, 8),
    [tasks],
  )
  const flaggedCount = React.useMemo(
    () => sessions.filter(meta => meta.isFlagged && meta.isArchived !== true).length,
    [sessions],
  )
  const unreadCount = React.useMemo(
    () => sessions.filter(meta => meta.hasUnread && meta.isArchived !== true).length,
    [sessions],
  )
  const reviewCount = React.useMemo(
    () => sessions.filter(meta => (meta.sessionStatus || 'todo') === 'needs-review' && meta.isArchived !== true).length,
    [sessions],
  )

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading queue…
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="space-y-4">
        <SurfaceCard
          kind="queue"
          metrics={[
            { label: 'Needs review', value: String(reviewCount), hint: 'Threads already waiting on judgment' },
            { label: 'Unread updates', value: String(unreadCount), hint: 'Fresh agent work since your last pass' },
            { label: 'Today tasks', value: String(tasks.filter(task => task.status === 'today').length), hint: 'Execution work waiting in notes' },
          ]}
          actions={[
            {
              label: 'Open tasks lane',
              description: 'Move from review into the note-backed execution list.',
              onClick: onOpenTasks,
            },
          ]}
          signals={[
            { label: 'Flagged threads', value: String(flaggedCount) },
            { label: 'Priority surfaced here', value: 'Review first, then execute' },
          ]}
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <ThreadListCard
            title="Review lane"
            subtitle="Threads that need judgment or follow-up now"
            threads={queueThreads}
            emptyMessage="Nothing is waiting in the thread review lane right now."
            onOpenThread={onOpenThread}
          />
          <TaskListCard
            title="Execution lane"
            subtitle="Today tasks waiting in the underlying project notes"
            tasks={todayTasks}
            emptyMessage="No today tasks are indexed yet. Promote note tasks into the Today lane to keep momentum obvious."
            onOpenTask={onOpenTask}
          />
        </div>
      </div>
    </div>
  )
}

export function BenjiProjectsNavigatorPanel({
  workspaceId,
  workspaceRootPath,
  vaultRootPath,
  selectedProjectId,
  onSelectProject,
}: {
  workspaceId?: string | null
  workspaceRootPath?: string | null
  vaultRootPath?: string | null
  selectedProjectId?: string | null
  onSelectProject: (projectId: string) => void
}) {
  const { projects, isLoading } = useWaveOneProjects(workspaceId, workspaceRootPath, vaultRootPath)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/40 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Wave 1</div>
        <div className="mt-1 text-sm font-medium text-foreground">Project canvases</div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="px-2 py-3 text-sm text-muted-foreground">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-border/50 px-3 py-4 text-sm leading-6 text-muted-foreground">
            Add project notes to your vault and they will appear here as Benji canvases.
          </div>
        ) : (
          <div className="space-y-1.5">
            {projects.map(project => {
              const isSelected = project.id === selectedProjectId
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    'w-full rounded-[14px] border px-3 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-accent/30 bg-accent/10'
                      : 'border-border/40 bg-background/60 hover:bg-background',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {project.kind === 'folder' ? (
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <NotebookTabs className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium text-foreground">{project.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {project.noteCount} note{project.noteCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {project.rootPath}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export function BenjiProjectCanvas({
  workspaceId,
  workspaceRootPath,
  vaultRootPath,
  selectedProjectId,
  sessions,
  onOpenThread,
  onOpenTask,
  onOpenTasks,
  onOpenQueue,
}: {
  workspaceId?: string | null
  workspaceRootPath?: string | null
  vaultRootPath?: string | null
  selectedProjectId?: string | null
  sessions: SessionMeta[]
  onOpenThread: (sessionId: string) => void
  onOpenTask: (task: WaveOneTaskItem) => void
  onOpenTasks: () => void
  onOpenQueue: () => void
}) {
  const { projects, isLoading } = useWaveOneProjects(workspaceId, workspaceRootPath, vaultRootPath)
  const { tasks } = useWaveOneTasks(workspaceRootPath, vaultRootPath)
  const selectedProject = React.useMemo(
    () => resolveWaveOneProject(projects, selectedProjectId),
    [projects, selectedProjectId],
  )
  const relatedThreads = React.useMemo(
    () => selectedProject ? deriveProjectThreads(selectedProject, sessions).slice(0, 6) : [],
    [selectedProject, sessions],
  )
  const projectReviewCount = React.useMemo(
    () => relatedThreads.filter(thread => thread.status === 'needs-review').length,
    [relatedThreads],
  )
  const projectUnreadCount = React.useMemo(
    () => relatedThreads.filter(thread => thread.hasUnread).length,
    [relatedThreads],
  )
  const projectInProgressCount = React.useMemo(
    () => relatedThreads.filter(thread => thread.status === 'in-progress').length,
    [relatedThreads],
  )
  const relatedTasks = React.useMemo(
    () => selectedProject ? filterTasksForProject(selectedProject, tasks).slice(0, 6) : [],
    [selectedProject, tasks],
  )
  const projectTaskCounts = React.useMemo(() => ({
    today: relatedTasks.filter(task => task.status === 'today').length,
    upcoming: relatedTasks.filter(task => task.status === 'upcoming').length,
    anytime: relatedTasks.filter(task => task.status === 'anytime').length,
  }), [relatedTasks])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading project canvas…
      </div>
    )
  }

  if (!selectedProject) {
    return (
      <BenjiMainSurface
        kind="projects"
        metrics={[
          { label: 'Visible projects', value: String(projects.length), hint: 'Derived from top-level vault notes and folders' },
        ]}
        signals={[
          { label: 'Default project surface', value: 'Canvas shell' },
          { label: 'Primary source', value: vaultRootPath ? 'Vault' : 'Workspace notes' },
        ]}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-5">
      <div className="rounded-[18px] border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Project Canvas</div>
        <div className="mt-2 flex items-center gap-2">
          {selectedProject.kind === 'folder' ? (
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          ) : (
            <NotebookTabs className="h-4 w-4 text-muted-foreground" />
          )}
          <h2 className="text-2xl font-medium text-foreground">{selectedProject.title}</h2>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          This Wave 1 canvas keeps the living note at the center while we attach tasks, threads, and review context around it.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Project path</div>
            <div className="mt-2 text-sm font-medium text-foreground">{selectedProject.rootPath}</div>
          </div>
          <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Notes in scope</div>
            <div className="mt-2 text-sm font-medium text-foreground">{selectedProject.noteCount}</div>
          </div>
          <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Primary document</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {selectedProject.primaryNotePath ?? 'Pending'}
            </div>
          </div>
          <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Active threads</div>
            <div className="mt-2 text-sm font-medium text-foreground">{projectInProgressCount}</div>
          </div>
          <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Needs review</div>
            <div className="mt-2 text-sm font-medium text-foreground">{projectReviewCount}</div>
          </div>
          <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Unread updates</div>
            <div className="mt-2 text-sm font-medium text-foreground">{projectUnreadCount}</div>
          </div>
        </div>
      </div>
      <div className="mt-4 min-h-0 flex flex-1 gap-4">
        <div className="min-h-0 flex-1 overflow-hidden rounded-[18px] border border-border/50 bg-background/80">
          {selectedProject.primaryNotePath ? (
            <VaultNoteEditorPanel
              notePath={selectedProject.primaryNotePath}
              vaultRootPath={vaultRootPath}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
              This project does not have a primary note yet. Add a markdown file to the project folder to turn this into a live canvas.
            </div>
          )}
        </div>
        <div className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto">
          <div className="rounded-[18px] border border-border/50 bg-background/80 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">Project pulse</div>
            <div className="mt-3 space-y-3">
              <div className="rounded-[14px] border border-border/40 bg-background/60 px-3 py-3">
                <div className="text-xs text-muted-foreground">What this gives the user</div>
                <div className="mt-1 text-sm leading-6 text-foreground">
                  The note stays central, but review and execution context now stays in-frame instead of forcing a jump back out to global views.
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenTasks}
                className="w-full rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-left transition-colors hover:bg-background"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">Open related tasks</div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  Move from project context into note-backed execution.
                </div>
              </button>
              <button
                type="button"
                onClick={onOpenQueue}
                className="w-full rounded-[14px] border border-border/40 bg-background/60 px-3 py-3 text-left transition-colors hover:bg-background"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-foreground">Open queue</div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  Clear review items and unread updates without losing project context.
                </div>
              </button>
            </div>
          </div>
          <TaskListCard
            title="Related tasks"
            subtitle={`Today ${projectTaskCounts.today} · Upcoming ${projectTaskCounts.upcoming} · Anytime ${projectTaskCounts.anytime}`}
            tasks={relatedTasks}
            emptyMessage="No note-backed tasks are in this project yet. Add <task-card> blocks to the project notes to make the execution lane visible here."
            onOpenTask={onOpenTask}
          />
          <ThreadListCard
            title="Related threads"
            subtitle="Likely project work"
            threads={relatedThreads}
            emptyMessage="No project-scoped threads matched yet. As sessions mention this project in their title, preview, or working directory, they will appear here."
            onOpenThread={onOpenThread}
          />
        </div>
      </div>
    </div>
  )
}
