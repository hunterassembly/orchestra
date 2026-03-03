/**
 * InputSettingsPage
 *
 * Input behavior settings that control how the chat input works.
 *
 * Settings:
 * - Auto Capitalisation (on/off)
 * - Spell Check (on/off)
 * - Push-to-talk Whisper (on/off)
 * - Send Message Key (Enter or ⌘+Enter)
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { isMac } from '@/lib/platform'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsMenuSelectRow,
} from '@/components/settings'

function simplifyMicrophoneLabel(label: string | undefined, index: number): string {
  const raw = (label || '').trim()
  if (!raw) return `Microphone ${index + 1}`

  // Remove noisy trailing hardware IDs e.g. " (19f7:0050)"
  const withoutIds = raw.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
  return withoutIds.trim() || `Microphone ${index + 1}`
}

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'input',
}

// ============================================
// Main Component
// ============================================

export default function InputSettingsPage() {
  // Auto-capitalisation state
  const [autoCapitalisation, setAutoCapitalisation] = useState(true)

  // Spell check state (default off)
  const [spellCheck, setSpellCheck] = useState(false)
  const [pushToTalkWhisper, setPushToTalkWhisper] = useState(false)
  const [whisperMicrophoneId, setWhisperMicrophoneId] = useState('default')
  const [microphones, setMicrophones] = useState<Array<{ value: string; label: string; description?: string }>>([
    { value: 'default', label: 'Default microphone' },
  ])

  // Send message key state
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter'>('enter')

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!window.electronAPI) return
      try {
        const [autoCapEnabled, spellCheckEnabled, sendKey, pushToTalkEnabled, micId] = await Promise.all([
          window.electronAPI.getAutoCapitalisation(),
          window.electronAPI.getSpellCheck(),
          window.electronAPI.getSendMessageKey(),
          window.electronAPI.getPushToTalkWhisper(),
          window.electronAPI.getWhisperMicrophoneId(),
        ])
        setAutoCapitalisation(autoCapEnabled)
        setSpellCheck(spellCheckEnabled)
        setSendMessageKey(sendKey)
        setPushToTalkWhisper(pushToTalkEnabled)
        setWhisperMicrophoneId(micId || 'default')
      } catch (error) {
        console.error('Failed to load input settings:', error)
      }
    }
    loadSettings()
  }, [])

  useEffect(() => {
    const loadMicrophones = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = devices.filter(d => d.kind === 'audioinput')
        const options = [
          { value: 'default', label: 'Default microphone' },
          ...audioInputs
            .filter(d => d.deviceId !== 'default')
            .map((d, idx) => ({
              value: d.deviceId,
              label: simplifyMicrophoneLabel(d.label, idx),
            })),
        ]
        setMicrophones(options)
      } catch (error) {
        console.error('Failed to enumerate microphones:', error)
      }
    }

    void loadMicrophones()
    const onDeviceChange = () => { void loadMicrophones() }
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
  }, [])

  const handleAutoCapitalisationChange = useCallback(async (enabled: boolean) => {
    setAutoCapitalisation(enabled)
    await window.electronAPI.setAutoCapitalisation(enabled)
  }, [])

  const handleSpellCheckChange = useCallback(async (enabled: boolean) => {
    setSpellCheck(enabled)
    await window.electronAPI.setSpellCheck(enabled)
  }, [])

  const handlePushToTalkWhisperChange = useCallback(async (enabled: boolean) => {
    setPushToTalkWhisper(enabled)
    await window.electronAPI.setPushToTalkWhisper(enabled)
  }, [])

  const handleWhisperMicrophoneChange = useCallback((value: string) => {
    setWhisperMicrophoneId(value)
    void window.electronAPI.setWhisperMicrophoneId(value)
  }, [])

  const handleSendMessageKeyChange = useCallback((value: string) => {
    const key = value as 'enter' | 'cmd-enter'
    setSendMessageKey(key)
    window.electronAPI.setSendMessageKey(key)
  }, [])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Input" actions={<HeaderMenu route={routes.view.settings('input')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {/* Typing Behavior */}
              <SettingsSection title="Typing" description="Control how text is entered in the chat input.">
                <SettingsCard>
                  <SettingsToggle
                    label="Auto capitalisation"
                    description="Automatically capitalise the first letter when typing a message."
                    checked={autoCapitalisation}
                    onCheckedChange={handleAutoCapitalisationChange}
                  />
                  <SettingsToggle
                    label="Spell check"
                    description="Underline misspelled words while typing."
                    checked={spellCheck}
                    onCheckedChange={handleSpellCheckChange}
                  />
                  <SettingsToggle
                    label="Hold Space to dictate"
                    description="Hold Space in the input to record, then transcribe with your local Whisper setup."
                    checked={pushToTalkWhisper}
                    onCheckedChange={handlePushToTalkWhisperChange}
                  />
                  <SettingsMenuSelectRow
                    label="Microphone"
                    description="Choose which microphone is used for push-to-talk dictation."
                    value={whisperMicrophoneId}
                    onValueChange={handleWhisperMicrophoneChange}
                    options={microphones}
                  />
                </SettingsCard>
              </SettingsSection>

              {/* Send Behavior */}
              <SettingsSection title="Sending" description="Choose how to send messages.">
                <SettingsCard>
                  <SettingsMenuSelectRow
                    label="Send message with"
                    description="Keyboard shortcut for sending messages"
                    value={sendMessageKey}
                    onValueChange={handleSendMessageKeyChange}
                    options={[
                      { value: 'enter', label: 'Enter', description: 'Use Shift+Enter for new lines' },
                      { value: 'cmd-enter', label: isMac ? '⌘ Enter' : 'Ctrl+Enter', description: 'Use Enter for new lines' },
                    ]}
                  />
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
