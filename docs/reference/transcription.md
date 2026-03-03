# Transcription Reference

This document explains how push-to-talk local transcription works in Orchestra Dev.

## User Flow

1. In **Settings → Input**, enable **Hold Space to dictate**.
2. Select a **Microphone** (or keep **Default microphone**).
3. In the chat input, hold **Space** to start recording.
4. Release **Space** to stop and transcribe.
5. Transcript is inserted at the cursor in the input box.

## Current Architecture (macOS)

- Trigger: `FreeFormInput` push-to-talk handlers in renderer.
- Capture path (preferred on macOS): native capture via main process IPC.
- Native capture: `ffmpeg` with `avfoundation`, writing 16k mono WAV.
- Transcription backend: local `whisper-cli` (`whisper.cpp`) first, Python Whisper fallback second.
- Model resolution: local model files under `~/.craft-agent-dev/models/whisper` and `~/.craft-agent/models/whisper`.

## Why Native Capture

Renderer `getUserMedia`/`MediaRecorder` can cause audio session side effects (ducking/channel interruption) on some setups. Native capture reduced this significantly for studio/XLR hardware chains.

## Settings & Config

- `pushToTalkWhisper` (boolean): enables/disables push-to-talk.
- `whisperMicrophoneId` (string): selected input device ID from settings.
- Runtime IPC channels:
  - `input:nativePttStart`
  - `input:nativePttStopAndTranscribe`
  - `input:transcribeLocalWhisper`

## Performance Notes

- For low latency, smaller English models are preferred first.
- For higher accuracy, consider using medium/large models (slower).

## Troubleshooting

### 1) "No module named whisper"
- Python fallback is missing. Usually safe to ignore if `whisper-cli` is working.
- Optional fix: install Python whisper (`python3 -m pip install openai-whisper`).

### 2) Transcription fails on webm/ogg input
- Ensure `ffmpeg` is installed and available on PATH.
- App converts incoming audio to WAV when needed.

### 3) Wrong microphone used
- Re-select microphone in **Settings → Input**.
- Native capture maps selected label to AVFoundation audio device index.

### 4) Headphone audio channel cuts/ducks
- Use native capture path (default on macOS in current implementation).
- Avoid communication DSP/AGC/NS/EC capture paths.

## Key Source Files

- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`
- `apps/electron/src/main/local-whisper.ts`
- `apps/electron/src/main/ipc.ts`
- `apps/electron/src/preload/index.ts`
- `apps/electron/src/renderer/pages/settings/InputSettingsPage.tsx`
- `packages/shared/src/config/storage.ts`
