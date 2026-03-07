import { ipcMain } from 'electron'
import { execSync } from 'child_process'
import { existsSync, lstatSync } from 'fs'
import { basename, dirname, extname, join, normalize } from 'path'
import type { SessionManager } from '@craft-agent/server-core/sessions'
import type { WindowManager } from './window-manager'
import type { BrowserPaneManager } from './browser-pane-manager'
import {
  IPC_CHANNELS,
  type GitBranchSwitchResult,
  type GitDiffStat,
  type GitRepoInfo,
  type GitStatusEntry,
  type SessionFile,
} from '../shared/types'

function normalizeVaultRelativePath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function assertVaultPath(rootPath: string, relativePath: string): { normalizedRoot: string; normalizedRelativePath: string; absolutePath: string } {
  if (!rootPath?.trim()) throw new Error('Vault root path is required')

  const normalizedRelativePath = normalizeVaultRelativePath(relativePath)
  if (normalizedRelativePath.includes('..')) {
    throw new Error('Invalid path: directory traversal not allowed')
  }

  const normalizedRoot = normalize(rootPath)
  const absolutePath = normalize(join(normalizedRoot, normalizedRelativePath))
  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new Error('Invalid path: outside vault directory')
  }

  return { normalizedRoot, normalizedRelativePath, absolutePath }
}

function assertAllowedVaultExtension(relativePath: string): void {
  const lower = relativePath.toLowerCase()
  if (!(lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt'))) {
    throw new Error('Invalid file type: only .md, .markdown, and .txt are allowed')
  }
}

async function scanWorkspaceDirectory(dirPath: string): Promise<SessionFile[]> {
  const { readdir, stat } = await import('fs/promises')
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: SessionFile[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push({
        name: entry.name,
        path: fullPath,
        type: 'directory',
      })
      continue
    }

    const stats = await stat(fullPath)
    files.push({
      name: entry.name,
      path: fullPath,
      type: 'file',
      size: stats.size,
    })
  }

  return files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function registerIpcHandlers(
  _sessionManager: SessionManager,
  _windowManager: WindowManager,
  _browserPaneManager?: BrowserPaneManager,
): void {
  let workspaceFileWatcher: import('fs').FSWatcher | null = null
  let watchedWorkspacePath: string | null = null
  let workspaceFileChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const cleanupWorkspaceWatcher = () => {
    if (workspaceFileWatcher) {
      workspaceFileWatcher.close()
      workspaceFileWatcher = null
    }
    if (workspaceFileChangeDebounceTimer) {
      clearTimeout(workspaceFileChangeDebounceTimer)
      workspaceFileChangeDebounceTimer = null
    }
    watchedWorkspacePath = null
  }

  ipcMain.handle(IPC_CHANNELS.GET_WORKSPACE_FILES, async (_event, rootPath: string): Promise<SessionFile[]> => {
    if (!rootPath) return []
    try {
      return await scanWorkspaceDirectory(rootPath)
    } catch (error) {
      console.error('[workspace-files] Failed to get workspace files:', error)
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.WATCH_WORKSPACE_FILES, async (_event, rootPath: string) => {
    if (!rootPath) return

    cleanupWorkspaceWatcher()
    watchedWorkspacePath = rootPath

    try {
      const { watch } = await import('fs')
      workspaceFileWatcher = watch(rootPath, {}, () => {
        if (workspaceFileChangeDebounceTimer) {
          clearTimeout(workspaceFileChangeDebounceTimer)
        }
        workspaceFileChangeDebounceTimer = setTimeout(async () => {
          const { BrowserWindow } = await import('electron')
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC_CHANNELS.WORKSPACE_FILES_CHANGED, watchedWorkspacePath)
          }
        }, 200)
      })
    } catch (error) {
      console.error('[workspace-files] Failed to start workspace file watcher:', error)
    }
  })

  ipcMain.handle(IPC_CHANNELS.UNWATCH_WORKSPACE_FILES, async () => {
    cleanupWorkspaceWatcher()
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_WRITE_TEXT, async (_event, workspaceId: string, relativePath: string, content: string) => {
    const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/config')
    const { mkdir, writeFile } = await import('fs/promises')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const normalizedRelativePath = normalizeVaultRelativePath(relativePath)
    if (normalizedRelativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }
    assertAllowedVaultExtension(normalizedRelativePath)

    const absolutePath = normalize(join(workspace.rootPath, normalizedRelativePath))
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content ?? '', 'utf-8')
  })

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RENAME_TEXT, async (_event, workspaceId: string, oldRelativePath: string, newRelativePath: string): Promise<string> => {
    const { getWorkspaceByNameOrId } = await import('@craft-agent/shared/config')
    const { access, mkdir, rename } = await import('fs/promises')
    const { constants } = await import('fs')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const oldRelativePathNormalized = normalizeVaultRelativePath(oldRelativePath)
    const newRelativePathNormalized = normalizeVaultRelativePath(newRelativePath)
    if (oldRelativePathNormalized.includes('..') || newRelativePathNormalized.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    assertAllowedVaultExtension(oldRelativePathNormalized)
    assertAllowedVaultExtension(newRelativePathNormalized)

    const oldAbsolutePath = normalize(join(workspace.rootPath, oldRelativePathNormalized))
    if (!oldAbsolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid source path: outside workspace directory')
    }

    const baseDir = dirname(newRelativePathNormalized)
    const ext = extname(newRelativePathNormalized)
    const baseName = basename(newRelativePathNormalized, ext)

    for (let attempt = 1; attempt < 1000; attempt++) {
      const candidateName = attempt === 1 ? `${baseName}${ext}` : `${baseName}-${attempt}${ext}`
      const candidateRelativePath = baseDir === '.' ? candidateName : `${baseDir}/${candidateName}`
      const candidateAbsolutePath = normalize(join(workspace.rootPath, candidateRelativePath))

      if (!candidateAbsolutePath.startsWith(workspace.rootPath)) {
        continue
      }
      if (candidateAbsolutePath === oldAbsolutePath) {
        return candidateRelativePath
      }

      try {
        await access(candidateAbsolutePath, constants.F_OK)
      } catch {
        await mkdir(dirname(candidateAbsolutePath), { recursive: true })
        await rename(oldAbsolutePath, candidateAbsolutePath)
        return candidateRelativePath
      }
    }

    throw new Error('Unable to find a unique destination filename')
  })

  ipcMain.handle(IPC_CHANNELS.GET_GIT_REPO_INFO, async (_event, dirPath: string): Promise<GitRepoInfo | null> => {
    try {
      const runGit = (args: string, timeout = 5000): string =>
        execSync(`git ${args}`, {
          cwd: dirPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout,
        }).trim()

      const repoRoot = runGit('rev-parse --show-toplevel')
      const currentBranch = runGit('rev-parse --abbrev-ref HEAD')
      if (!repoRoot || !currentBranch) return null

      let trackingBranch: string | null = null
      try {
        trackingBranch = runGit('rev-parse --abbrev-ref --symbolic-full-name @{upstream}')
      } catch {
        trackingBranch = null
      }

      let branches: string[] = []
      try {
        branches = runGit("for-each-ref --format='%(refname:short)' refs/heads")
          .split('\n')
          .map((line) => line.trim().replace(/^'+|'+$/g, ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      } catch {
        branches = []
      }

      let repoName = basename(repoRoot)
      try {
        const remoteUrl = runGit('config --get remote.origin.url')
        const normalized = remoteUrl
          .replace(/\.git$/i, '')
          .replace(/^git@[^:]+:/i, '')
          .replace(/^https?:\/\/[^/]+\//i, '')
        if (normalized.includes('/')) {
          repoName = normalized
        }
      } catch {
        // no-op
      }

      const gitPath = join(repoRoot, '.git')
      const isWorktree = existsSync(gitPath) && lstatSync(gitPath).isFile()

      return {
        repoName,
        repoRoot,
        currentBranch,
        trackingBranch,
        branches,
        isWorktree,
        worktreeName: isWorktree ? basename(repoRoot) : null,
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.GIT_SWITCH_BRANCH, async (_event, dirPath: string, branch: string): Promise<GitBranchSwitchResult> => {
    const targetBranch = branch?.trim()
    if (!targetBranch) {
      return { success: false, branch: null, error: 'Branch name is required' }
    }

    try {
      const runGit = (args: string, timeout = 10000): string =>
        execSync(`git ${args}`, {
          cwd: dirPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout,
        }).trim()
      const branchExists = (ref: string): boolean => {
        try {
          runGit(`show-ref --verify --quiet ${JSON.stringify(ref)}`)
          return true
        } catch {
          return false
        }
      }

      const currentBranch = runGit('rev-parse --abbrev-ref HEAD')
      const localBranch = targetBranch.startsWith('origin/') ? targetBranch.replace(/^origin\//, '') : targetBranch
      const remoteBranch = targetBranch.startsWith('origin/') ? targetBranch : `origin/${targetBranch}`

      if (currentBranch === targetBranch || currentBranch === localBranch) {
        return { success: true, branch: currentBranch }
      }

      const hasLocalBranch = branchExists(`refs/heads/${localBranch}`)
      const hasRemoteBranch = branchExists(`refs/remotes/${remoteBranch}`)

      if (hasLocalBranch) {
        runGit(`checkout ${JSON.stringify(localBranch)}`)
      } else if (hasRemoteBranch) {
        runGit(`checkout --track -b ${JSON.stringify(localBranch)} ${JSON.stringify(remoteBranch)}`)
      } else {
        return { success: false, branch: null, error: `Branch not found: ${targetBranch}` }
      }

      const branchAfter = runGit('rev-parse --abbrev-ref HEAD')
      return { success: true, branch: branchAfter }
    } catch (error) {
      const message = error instanceof Error
        ? (() => {
            const stderr = (error as Error & { stderr?: string | Buffer }).stderr
            if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
            if (stderr && Buffer.isBuffer(stderr)) return stderr.toString('utf-8').trim()
            return error.message
          })()
        : 'Failed to switch git branch'
      return { success: false, branch: null, error: message }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GET_GIT_DIFF_STAT, async (_event, dirPath: string): Promise<GitDiffStat> => {
    try {
      const output = execSync('git diff --numstat HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })

      let added = 0
      let deleted = 0
      for (const line of output.split('\n')) {
        if (!line.trim()) continue
        const [addPart, delPart] = line.split('\t')
        if (addPart && addPart !== '-') {
          const parsed = Number.parseInt(addPart, 10)
          if (Number.isFinite(parsed)) added += parsed
        }
        if (delPart && delPart !== '-') {
          const parsed = Number.parseInt(delPart, 10)
          if (Number.isFinite(parsed)) deleted += parsed
        }
      }
      return { added, deleted }
    } catch {
      return { added: 0, deleted: 0 }
    }
  })

  ipcMain.handle(IPC_CHANNELS.GET_GIT_STATUS, async (_event, dirPath: string): Promise<GitStatusEntry[]> => {
    try {
      const output = execSync('git status --porcelain', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      })
      if (!output.trim()) return []

      const entries: GitStatusEntry[] = []
      for (const line of output.split('\n')) {
        if (!line) continue
        const indexStatus = line[0]
        const workTreeStatus = line[1]
        const filePath = line.slice(3)

        let status: string
        let staged = false
        if (indexStatus === '?' && workTreeStatus === '?') {
          status = '?'
        } else if (workTreeStatus !== ' ' && workTreeStatus !== undefined) {
          status = workTreeStatus
          staged = indexStatus !== ' ' && indexStatus !== '?'
        } else {
          status = indexStatus!
          staged = true
        }

        entries.push({ path: filePath, status, staged })
      }

      entries.sort((a, b) => a.path.localeCompare(b.path))
      return entries
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.GET_GIT_DIFF, async (_event, dirPath: string, filePath: string): Promise<string> => {
    try {
      return execSync(`git diff HEAD -- ${JSON.stringify(filePath)}`, {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        maxBuffer: 1024 * 1024 * 5,
      })
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_READ_TEXT, async (_event, vaultRootPath: string, relativePath: string): Promise<string> => {
    const { readFile } = await import('fs/promises')
    const { absolutePath } = assertVaultPath(vaultRootPath, relativePath)
    return readFile(absolutePath, 'utf-8')
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_WRITE_TEXT, async (_event, vaultRootPath: string, relativePath: string, content: string) => {
    const { mkdir, writeFile } = await import('fs/promises')
    const { dirname } = await import('path')
    const { normalizedRelativePath, absolutePath } = assertVaultPath(vaultRootPath, relativePath)
    assertAllowedVaultExtension(normalizedRelativePath)

    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content ?? '', 'utf-8')
  })

  ipcMain.handle(IPC_CHANNELS.VAULT_RENAME_TEXT, async (_event, vaultRootPath: string, oldRelativePath: string, newRelativePath: string): Promise<string> => {
    const { access, mkdir, rename } = await import('fs/promises')
    const { constants } = await import('fs')
    const { normalizedRoot, normalizedRelativePath: oldRelativePathNormalized, absolutePath: oldAbsolutePath } = assertVaultPath(vaultRootPath, oldRelativePath)
    const normalizedNewRelativePath = normalizeVaultRelativePath(newRelativePath)

    if (normalizedNewRelativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    assertAllowedVaultExtension(oldRelativePathNormalized)
    assertAllowedVaultExtension(normalizedNewRelativePath)

    const baseDir = dirname(normalizedNewRelativePath)
    const ext = extname(normalizedNewRelativePath)
    const baseName = basename(normalizedNewRelativePath, ext)

    for (let attempt = 1; attempt < 1000; attempt++) {
      const candidateName = attempt === 1 ? `${baseName}${ext}` : `${baseName}-${attempt}${ext}`
      const candidateRelativePath = baseDir === '.' ? candidateName : `${baseDir}/${candidateName}`
      const candidateAbsolutePath = normalize(join(normalizedRoot, candidateRelativePath))

      if (!candidateAbsolutePath.startsWith(normalizedRoot)) {
        continue
      }

      if (candidateAbsolutePath === oldAbsolutePath) {
        return candidateRelativePath
      }

      try {
        await access(candidateAbsolutePath, constants.F_OK)
      } catch {
        await mkdir(dirname(candidateAbsolutePath), { recursive: true })
        await rename(oldAbsolutePath, candidateAbsolutePath)
        return candidateRelativePath
      }
    }

    throw new Error('Unable to find a unique destination filename')
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_GET_PUSH_TO_TALK_WHISPER, async () => {
    const { getPushToTalkWhisper } = await import('@craft-agent/shared/config/storage')
    return getPushToTalkWhisper()
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_SET_PUSH_TO_TALK_WHISPER, async (_event, enabled: boolean) => {
    const { setPushToTalkWhisper } = await import('@craft-agent/shared/config/storage')
    setPushToTalkWhisper(enabled)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_GET_WHISPER_MICROPHONE_ID, async () => {
    const { getWhisperMicrophoneId } = await import('@craft-agent/shared/config/storage')
    return getWhisperMicrophoneId()
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_SET_WHISPER_MICROPHONE_ID, async (_event, deviceId: string) => {
    const { setWhisperMicrophoneId } = await import('@craft-agent/shared/config/storage')
    setWhisperMicrophoneId(deviceId)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_TRANSCRIBE_LOCAL_WHISPER, async (_event, audioBase64: string, mimeType: string) => {
    const { transcribeWithLocalWhisper } = await import('./local-whisper')
    return transcribeWithLocalWhisper(audioBase64, mimeType)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_NATIVE_PTT_START, async (_event, preferredDeviceLabel?: string) => {
    const { startNativePushToTalkCapture } = await import('./local-whisper')
    return startNativePushToTalkCapture(preferredDeviceLabel)
  })

  ipcMain.handle(IPC_CHANNELS.INPUT_NATIVE_PTT_STOP_AND_TRANSCRIBE, async () => {
    const { stopNativePushToTalkCaptureAndTranscribe } = await import('./local-whisper')
    return stopNativePushToTalkCaptureAndTranscribe()
  })
}
