import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000

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
    join(homedir(), '.craft-agent/models/whisper/ggml-large-v3-turbo.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-medium.en.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-small.en.bin'),
    join(homedir(), '.craft-agent/models/whisper/ggml-base.en.bin'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function runWhisperCpp(inputPath: string, tempDir: string): Promise<string | null> {
  const modelPath = resolveWhisperModelPath()
  if (!modelPath) return null

  const whisperCli = resolveWhisperCliPath()
  const outputBase = join(tempDir, 'transcript')

  await execFileAsync(
    whisperCli,
    [
      '-m', modelPath,
      '-f', inputPath,
      '-l', 'auto',
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

export async function transcribeWithLocalWhisper(audioBase64: string, mimeType: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'orchestra-whisper-'))
  const extension = extensionForMime(mimeType)
  const audioPath = join(tempDir, `input.${extension}`)

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64')
    await writeFile(audioPath, audioBuffer)

    const errors: string[] = []

    try {
      const text = await runWhisperCpp(audioPath, tempDir)
      if (text) return text
    } catch (error) {
      errors.push(`whisper.cpp failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const text = await runPythonWhisper(audioPath, tempDir)
      if (text) return text
    } catch (error) {
      errors.push(`python whisper failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    throw new Error(
      errors.length > 0
        ? `Unable to transcribe audio. ${errors.join(' | ')}`
        : 'Unable to transcribe audio. No local Whisper backend produced a transcript.'
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
