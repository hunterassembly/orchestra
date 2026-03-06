import { ipcMain } from 'electron'
import { basename, dirname, extname, join, normalize } from 'path'
import type { SessionManager } from '@craft-agent/server-core/sessions'
import type { WindowManager } from './window-manager'
import type { BrowserPaneManager } from './browser-pane-manager'
import { IPC_CHANNELS } from '../shared/types'

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

export function registerIpcHandlers(
  _sessionManager: SessionManager,
  _windowManager: WindowManager,
  _browserPaneManager?: BrowserPaneManager,
): void {
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
