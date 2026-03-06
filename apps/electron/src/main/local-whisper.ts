import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { execFile, spawn, type ChildProcessByStdio } from 'child_process'
import type { Writable, Readable } from 'stream'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const NATIVE_STOP_TIMEOUT_MS = 5000

type NativePttSession = {
  tempDir: string
  audioPath: string
  ffmpegProcess: ChildProcessByStdio<Writable, null, Readable>
}

let nativePttSession: NativePttSession | null = null

function formatExecError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const anyErr = error as Error & { code?: string | number; stdout?: string; stderr?: string; signal?: string }
  const parts = [anyErr.message]
  if (anyErr.code !== undefined) parts.push(`code=${String(anyErr.code)}`)
  if (anyErr.signal) parts.push(`signal=${anyErr.signal}`)
  if (anyErr.stderr?.trim()) parts.push(`stderr=${anyErr.stderr.trim().slice(0, 400)}`)
  if (anyErr.stdout?.trim()) parts.push(`stdout=${anyErr.stdout.trim().slice(0, 200)}`)
  return parts.join(' | ')
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp4') || mimeType.includes('mpeg')) return 'mp4'
  return 'webm'
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) return null
    const content = await readFile(path, 'utf-8')
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

function resolveWhisperCliPath(): string {
  const candidates = [
    process.env.WHISPER_CPP_PATH,
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
    'whisper-cli',
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (candidate === 'whisper-cli' || existsSync(candidate)) {
      return candidate
    }
  }
  return 'whisper-cli'
}

function resolveWhisperModelPath(): string | null {
  const candidates = [
    process.env.WHISPER_CPP_MODEL_PATH,
    // Prefer better accuracy while keeping reasonable latency.
    join(homedir(), '.craft-agent-dev/models/whisper/ggml-medium.en.bin'),
    join(homedir(), '.craft-agent-dev/models/whisper/ggml-small.en.bin'),
    join(homedir(), '.craft-agent-dev/models/whisper/ggml-large-v3-turbo.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-medium.en.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-small.en.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-large-v3-turbo.bin'),
    join(homedir(), '.craft-agent-dev/models/whisper/ggml-base.en.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-base.en.bin'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveFfmpegPath(): string {
  const candidates = [
    process.env.FFMPEG_PATH,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (candidate === 'ffmpeg' || existsSync(candidate)) {
      return candidate
    }
  }
  return 'ffmpeg'
}

function normalizeAudioDeviceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function listAvfoundationAudioDevices(): Promise<Array<{ index: number; name: string }>> {
  const ffmpeg = resolveFfmpegPath()
  try {
    await execFileAsync(ffmpeg, ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { timeout: 5000 })
  } catch (error) {
    const anyErr = error as Error & { stdout?: string; stderr?: string }
    const output = `${anyErr.stderr ?? ''}\n${anyErr.stdout ?? ''}`
    const lines = output.split('\n')
    const devices: Array<{ index: number; name: string }> = []
    let inAudioSection = false

    for (const line of lines) {
      if (line.includes('AVFoundation audio devices')) {
        inAudioSection = true
        continue
      }
      if (inAudioSection && line.includes('AVFoundation video devices')) {
        break
      }
      if (!inAudioSection) continue

      const match = line.match(/\[\s*(\d+)\s*\]\s*(.+)$/)
      if (!match) continue
      const index = Number.parseInt(match[1], 10)
      const name = match[2].trim()
      if (Number.isFinite(index) && name) {
        devices.push({ index, name })
      }
    }

    return devices
  }

  return []
}

async function maybeConvertToWav(inputPath: string, tempDir: string): Promise<string> {
  const wavPath = join(tempDir, 'input.wav')
  const ffmpeg = resolveFfmpegPath()
  try {
    await execFileAsync(
      ffmpeg,
      ['-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath],
      { timeout: DEFAULT_TIMEOUT_MS }
    )
    if (existsSync(wavPath)) return wavPath
  } catch {
    // Fall back to original input path if conversion fails or ffmpeg isn't installed.
  }
  return inputPath
}

async function runWhisperCpp(inputPath: string, tempDir: string): Promise<string | null> {
  const modelPath = resolveWhisperModelPath()
  if (!modelPath) return null

  const whisperCli = resolveWhisperCliPath()
  const outputBase = join(tempDir, 'transcript')
  const preparedInputPath = await maybeConvertToWav(inputPath, tempDir)

  await execFileAsync(
    whisperCli,
    [
      '-m', modelPath,
      '-f', preparedInputPath,
      '-l', 'en',
      '--no-timestamps',
      '-otxt',
      '-of', outputBase,
    ],
    { timeout: DEFAULT_TIMEOUT_MS }
  )

  return readIfExists(`${outputBase}.txt`)
}

async function runPythonWhisper(inputPath: string, tempDir: string): Promise<string | null> {
  const pythonBin = process.env.WHISPER_PYTHON_BIN || 'python3'
  const model = process.env.WHISPER_MODEL || 'base'

  await execFileAsync(
    pythonBin,
    [
      '-m', 'whisper',
      inputPath,
      '--model', model,
      '--output_dir', tempDir,
      '--output_format', 'txt',
      '--fp16', 'False',
    ],
    { timeout: DEFAULT_TIMEOUT_MS }
  )

  const stem = basename(inputPath).replace(/\.[^.]+$/, '')
  return readIfExists(join(tempDir, `${stem}.txt`))
}

async function transcribeAudioFile(inputPath: string, tempDir: string, mimeHint?: string): Promise<string> {
  const errors: string[] = []
  const size = (await stat(inputPath)).size

  try {
    const text = await runWhisperCpp(inputPath, tempDir)
    if (text) return text
  } catch (error) {
    errors.push(`whisper.cpp failed: ${formatExecError(error)}`)
  }

  try {
    const text = await runPythonWhisper(inputPath, tempDir)
    if (text) return text
  } catch (error) {
    errors.push(`python whisper failed: ${formatExecError(error)}`)
  }

  throw new Error(
    errors.length > 0
      ? `Unable to transcribe audio (mime=${mimeHint ?? 'unknown'}, bytes=${size}). ${errors.join(' | ')}`
      : `Unable to transcribe audio (mime=${mimeHint ?? 'unknown'}, bytes=${size}). No local Whisper backend produced a transcript.`
  )
}

async function resolveNativeAudioInput(preferredDeviceLabel?: string): Promise<string> {
  // avfoundation format: "<video_index>:<audio_index>"
  // ":0" means no video, default/first microphone.
  const fromEnv = process.env.WHISPER_AVFOUNDATION_INPUT
  if (fromEnv) return fromEnv

  if (!preferredDeviceLabel || preferredDeviceLabel.trim().length === 0 || preferredDeviceLabel === 'Default microphone') {
    return ':0'
  }

  const devices = await listAvfoundationAudioDevices()
  if (devices.length === 0) return ':0'

  const target = normalizeAudioDeviceName(preferredDeviceLabel)
  const match = devices.find(d => normalizeAudioDeviceName(d.name) === target)
    ?? devices.find(d => normalizeAudioDeviceName(d.name).includes(target))
    ?? devices.find(d => target.includes(normalizeAudioDeviceName(d.name)))

  if (match) return `:${match.index}`
  return ':0'
}

export async function startNativePushToTalkCapture(preferredDeviceLabel?: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Native push-to-talk capture is only supported on macOS')
  }

  if (nativePttSession) return

  const tempDir = await mkdtemp(join(tmpdir(), 'orchestra-whisper-native-'))
  const audioPath = join(tempDir, 'native-input.wav')
  const ffmpeg = resolveFfmpegPath()
  const input = await resolveNativeAudioInput(preferredDeviceLabel)

  const ffmpegProcess = spawn(
    ffmpeg,
    ['-f', 'avfoundation', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', audioPath],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  )

  nativePttSession = { tempDir, audioPath, ffmpegProcess }
}

async function stopNativeCaptureProcess(session: NativePttSession): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }

    session.ffmpegProcess.once('close', finish)
    session.ffmpegProcess.once('error', finish)

    try {
      session.ffmpegProcess.stdin.write('q\n')
    } catch {
      // ignored
    }

    setTimeout(() => {
      if (!settled) {
        try { session.ffmpegProcess.kill('SIGKILL') } catch { /* noop */ }
        finish()
      }
    }, NATIVE_STOP_TIMEOUT_MS)
  })
}

export async function stopNativePushToTalkCaptureAndTranscribe(): Promise<string> {
  const session = nativePttSession
  if (!session) {
    throw new Error('Native push-to-talk capture was not started')
  }
  nativePttSession = null

  try {
    await stopNativeCaptureProcess(session)

    const info = await stat(session.audioPath)
    if (!info.isFile() || info.size === 0) {
      throw new Error('Native capture produced empty audio')
    }

    return await transcribeAudioFile(session.audioPath, session.tempDir, 'audio/wav')
  } finally {
    await rm(session.tempDir, { recursive: true, force: true })
  }
}

export async function transcribeWithLocalWhisper(audioBase64: string, mimeType: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'orchestra-whisper-'))
  const extension = extensionForMime(mimeType)
  const audioPath = join(tempDir, `input.${extension}`)

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64')
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Captured audio buffer is empty (0 bytes)')
    }
    await writeFile(audioPath, audioBuffer)

    return await transcribeAudioFile(audioPath, tempDir, mimeType)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
