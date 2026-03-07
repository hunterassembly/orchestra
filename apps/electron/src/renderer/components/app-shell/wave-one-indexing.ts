export type WaveOneTaskSection = 'today' | 'upcoming' | 'anytime'

export interface WaveOneNoteEntry {
  path: string
  relativePath: string
  title: string
}

export interface WaveOneTaskItem {
  id: string
  title: string
  status: WaveOneTaskSection
  dueDate?: string
  assignee?: string
  description?: string
  notePath: string
  noteTitle: string
}

export interface WaveOneProjectScope {
  kind: 'note' | 'folder'
  rootPath: string
  primaryNotePath: string | null
}

interface WorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

function getAttr(attrs: string, key: string): string {
  const match = attrs.match(new RegExp(`${key}="([^"]*)"`, 'i'))
  return match?.[1] ?? ''
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdc')
}

export function stripNoteExtension(name: string): string {
  return name.replace(/\.(md|markdown|mdc)$/i, '')
}

export function getNotesBasePath(workspaceRootPath?: string | null, vaultRootPath?: string | null): string | null {
  const effectiveRootPath = vaultRootPath || workspaceRootPath
  if (!effectiveRootPath) return null
  const normalizedRoot = effectiveRootPath.replace(/\/$/, '')
  return vaultRootPath ? normalizedRoot : `${normalizedRoot}/notes`
}

export function toRelativePath(basePath: string, absolutePath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, '')
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  const rootWithSlash = `${normalizedBase}/`
  if (normalizedPath.startsWith(rootWithSlash)) {
    return normalizedPath.slice(rootWithSlash.length)
  }
  return normalizedPath
}

async function getDirectoryEntries(path: string): Promise<WorkspaceEntry[]> {
  const entries = await window.electronAPI.getWorkspaceFiles(path)
  return entries.filter(entry => !entry.name.startsWith('.'))
}

export async function listMarkdownNotes(basePath: string, dirPath: string = basePath): Promise<WaveOneNoteEntry[]> {
  const entries = await getDirectoryEntries(dirPath)
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.type === 'directory') return listMarkdownNotes(basePath, entry.path)
    if (!isMarkdownFile(entry.name)) return []

    const relativePath = toRelativePath(basePath, entry.path)
    return [{
      path: entry.path,
      relativePath,
      title: stripNoteExtension(entry.name),
    }]
  }))

  return nested.flat()
}

export async function loadWaveOneTasks(
  workspaceRootPath?: string | null,
  vaultRootPath?: string | null,
): Promise<WaveOneTaskItem[]> {
  const notesBasePath = getNotesBasePath(workspaceRootPath, vaultRootPath)
  if (!notesBasePath) return []

  const notes = await listMarkdownNotes(notesBasePath)
  const parsed: WaveOneTaskItem[] = []

  await Promise.all(notes.map(async (note) => {
    const markdown = vaultRootPath
      ? await window.electronAPI.readVaultText(vaultRootPath, note.relativePath)
      : await window.electronAPI.readFile(note.path)
    const matches = markdown.matchAll(/<task-card([^>]*)>([\s\S]*?)<\/task-card>/gi)

    for (const match of matches) {
      const attrs = match[1] ?? ''
      const inner = match[2] ?? ''
      const statusRaw = (getAttr(attrs, 'status') || 'anytime').toLowerCase()
      const status: WaveOneTaskSection = statusRaw === 'today' || statusRaw === 'upcoming' || statusRaw === 'anytime'
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

  return parsed.sort((a, b) => {
    if (a.status !== b.status) {
      const order: Record<WaveOneTaskSection, number> = { today: 0, upcoming: 1, anytime: 2 }
      return order[a.status] - order[b.status]
    }
    if (!!a.dueDate !== !!b.dueDate) return a.dueDate ? -1 : 1
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function filterTasksForProject(project: WaveOneProjectScope, tasks: WaveOneTaskItem[]): WaveOneTaskItem[] {
  if (project.kind === 'note') {
    return project.primaryNotePath ? tasks.filter(task => task.notePath === project.primaryNotePath) : []
  }

  const projectPrefix = `${project.rootPath}/`
  return tasks.filter(task =>
    task.notePath === project.primaryNotePath
    || task.notePath.startsWith(projectPrefix),
  )
}
