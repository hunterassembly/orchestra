import * as React from 'react'
import * as storage from '@/lib/local-storage'
import { slugify } from '@/lib/slugify'
import {
  getNotesBasePath,
  isMarkdownFile,
  listMarkdownNotes,
  stripNoteExtension,
  toRelativePath,
} from './wave-one-indexing'

export interface BenjiProjectRecord {
  id: string
  title: string
  kind: 'note' | 'folder'
  rootPath: string
  primaryNotePath: string | null
  noteCount: number
  source: 'imported' | 'manual'
  createdAt: number
  updatedAt: number
}

interface DiscoveredProject {
  title: string
  kind: 'note' | 'folder'
  rootPath: string
  primaryNotePath: string | null
  noteCount: number
}

interface WorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

async function getDirectoryEntries(path: string): Promise<WorkspaceEntry[]> {
  const entries = await window.electronAPI.getWorkspaceFiles(path)
  return entries.filter(entry => !entry.name.startsWith('.'))
}

async function loadDiscoveredProjects(
  workspaceRootPath?: string | null,
  vaultRootPath?: string | null,
): Promise<DiscoveredProject[]> {
  const basePath = getNotesBasePath(workspaceRootPath, vaultRootPath)
  if (!basePath) return []

  const topLevel = await getDirectoryEntries(basePath)
  const projects: DiscoveredProject[] = []

  for (const entry of topLevel) {
    const relativePath = toRelativePath(basePath, entry.path)

    if (entry.type === 'directory') {
      const notes = await listMarkdownNotes(basePath, entry.path)
      if (notes.length === 0) continue
      const notePaths = notes.map(note => note.relativePath)

      const matchingIndex = notePaths.find(path => {
        const normalized = stripNoteExtension(path.split('/').pop() || '')
        return normalized.toLowerCase() === entry.name.toLowerCase()
      })
      const primaryNote =
        matchingIndex
        || notePaths.find(path => path.toLowerCase().endsWith('/index.md'))
        || notePaths.find(path => path.toLowerCase().endsWith('/readme.md'))
        || notePaths[0]

      projects.push({
        title: entry.name,
        kind: 'folder',
        rootPath: relativePath,
        primaryNotePath: primaryNote ?? null,
        noteCount: notePaths.length,
      })
      continue
    }

    if (!isMarkdownFile(entry.name)) continue

    projects.push({
      title: stripNoteExtension(entry.name),
      kind: 'note',
      rootPath: relativePath,
      primaryNotePath: relativePath,
      noteCount: 1,
    })
  }

  return projects.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function buildWorkspaceProjectsSuffix(workspaceId?: string | null): string {
  return workspaceId || 'global'
}

function createImportedProjectId(project: DiscoveredProject, takenIds: Set<string>): string {
  const rawSeed = project.rootPath.replace(/[\/\\]+/g, '-')
  const baseSlug = slugify(rawSeed) || slugify(project.title) || 'project'
  let nextId = `project-${baseSlug}`
  let counter = 2

  while (takenIds.has(nextId)) {
    nextId = `project-${baseSlug}-${counter}`
    counter += 1
  }

  takenIds.add(nextId)
  return nextId
}

function mergeProjects(
  storedProjects: BenjiProjectRecord[],
  discoveredProjects: DiscoveredProject[],
): BenjiProjectRecord[] {
  const takenIds = new Set(storedProjects.map(project => project.id))
  const now = Date.now()

  const discoveredMerged = discoveredProjects.map((project) => {
    const existing = storedProjects.find(stored =>
      stored.rootPath === project.rootPath
      || (stored.primaryNotePath && stored.primaryNotePath === project.primaryNotePath),
    )

    if (existing) {
      return {
        ...existing,
        title: project.title,
        kind: project.kind,
        rootPath: project.rootPath,
        primaryNotePath: project.primaryNotePath,
        noteCount: project.noteCount,
      }
    }

    return {
      id: createImportedProjectId(project, takenIds),
      title: project.title,
      kind: project.kind,
      rootPath: project.rootPath,
      primaryNotePath: project.primaryNotePath,
      noteCount: project.noteCount,
      source: 'imported' as const,
      createdAt: now,
      updatedAt: now,
    }
  })

  const manualProjects = storedProjects.filter(stored =>
    stored.source === 'manual'
    && !discoveredMerged.some(project => project.id === stored.id),
  )

  return [...discoveredMerged, ...manualProjects].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function useWaveOneProjects(
  workspaceId?: string | null,
  workspaceRootPath?: string | null,
  vaultRootPath?: string | null,
) {
  const [projects, setProjects] = React.useState<BenjiProjectRecord[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const storageSuffix = React.useMemo(
    () => buildWorkspaceProjectsSuffix(workspaceId),
    [workspaceId],
  )

  React.useEffect(() => {
    let cancelled = false

    async function run() {
      setIsLoading(true)
      try {
        const discovered = await loadDiscoveredProjects(workspaceRootPath, vaultRootPath)
        const stored = storage.get<BenjiProjectRecord[]>(storage.KEYS.benjiProjects, [], storageSuffix)
        const merged = mergeProjects(stored, discovered)

        if (!cancelled) {
          setProjects(merged)
        }

        storage.set(storage.KEYS.benjiProjects, merged, storageSuffix)
      } catch {
        if (!cancelled) {
          const stored = storage.get<BenjiProjectRecord[]>(storage.KEYS.benjiProjects, [], storageSuffix)
          setProjects(stored)
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
  }, [storageSuffix, workspaceRootPath, vaultRootPath])

  return { projects, isLoading }
}

export function resolveWaveOneProject(
  projects: BenjiProjectRecord[],
  selectedProjectId?: string | null,
): BenjiProjectRecord | null {
  if (!selectedProjectId) return null

  return projects.find(project => project.id === selectedProjectId)
    ?? projects.find(project => project.rootPath === selectedProjectId)
    ?? projects.find(project => project.primaryNotePath === selectedProjectId)
    ?? null
}
