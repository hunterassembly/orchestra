/**
 * TabContentRenderer - Renders tab content inline using embedded overlay components
 *
 * Routes FileTab → embedded file preview (code, image, json, etc.)
 * Routes TurnTab → embedded turn overlay (activity, multi-diff, markdown)
 */

import * as React from 'react'
import { useMemo } from 'react'
import { PenLine, GitCompareArrows } from 'lucide-react'
import {
  CodePreviewOverlay,
  JSONPreviewOverlay,
  MultiDiffPreviewOverlay,
  TerminalPreviewOverlay,
  GenericOverlay,
  DocumentFormattedMarkdownOverlay,
  ImagePreviewOverlay,
  PDFPreviewOverlay,
  PreviewOverlay,
  ContentFrame,
  extractOverlayData,
  detectLanguage,
  type OverlayData,
  type DiffViewerSettings,
} from '@craft-agent/ui'
import { UnifiedDiffViewer } from '@craft-agent/ui'
import { useTheme } from '@/hooks/useTheme'
import type { Tab, FileTab, TurnTab, WorkflowTab } from '@/hooks/useChatTabs'

export interface TabContentRendererProps {
  tab: Tab
  onClose: () => void
  /** Read file as data URL for image previews */
  readFileDataUrl?: (path: string) => Promise<string>
  /** Read file as binary for PDF previews */
  readFileBinary?: (path: string) => Promise<Uint8Array>
  /** Open file externally */
  onOpenFile?: (path: string) => void
  /** Open URL externally */
  onOpenUrl?: (url: string) => void
}

export function TabContentRenderer({
  tab,
  onClose,
  readFileDataUrl,
  readFileBinary,
  onOpenFile,
  onOpenUrl,
}: TabContentRendererProps) {
  if (tab.kind === 'file') {
    return (
      <FileTabContent
        tab={tab}
        onClose={onClose}
        readFileDataUrl={readFileDataUrl}
        readFileBinary={readFileBinary}
      />
    )
  }

  if (tab.kind === 'turn') {
    return (
      <TurnTabContent
        tab={tab}
        onClose={onClose}
        onOpenFile={onOpenFile}
        onOpenUrl={onOpenUrl}
      />
    )
  }

  if (tab.kind === 'workflow') {
    return <WorkflowTabContent tab={tab} />
  }

  return null
}

// ============================================================
// FileTabContent — mirrors FilePreviewRenderer in App.tsx
// ============================================================

function FileTabContent({
  tab,
  onClose,
  readFileDataUrl,
  readFileBinary,
}: {
  tab: FileTab
  onClose: () => void
  readFileDataUrl?: (path: string) => Promise<string>
  readFileBinary?: (path: string) => Promise<Uint8Array>
}) {
  const { isDark } = useTheme()
  const theme = isDark ? 'dark' : ('light' as const)
  const state = tab.previewState

  switch (state.type) {
    case 'image':
      return readFileDataUrl ? (
        <ImagePreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          loadDataUrl={readFileDataUrl}
          theme={theme}
          embedded
        />
      ) : null

    case 'pdf':
      return readFileBinary ? (
        <PDFPreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          loadPdfData={readFileBinary}
          theme={theme}
          embedded
        />
      ) : null

    case 'code':
    case 'text':
      return (
        <CodePreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          content={state.content ?? ''}
          language={state.type === 'code' ? state.language : 'plaintext'}
          mode="read"
          theme={theme}
          error={state.error}
          embedded
        />
      )

    case 'markdown': {
      const isPlanFile =
        (state.filePath.includes('/plans/') || state.filePath.startsWith('plans/')) &&
        state.filePath.endsWith('.md')
      return (
        <DocumentFormattedMarkdownOverlay
          isOpen
          onClose={onClose}
          content={state.content ?? ''}
          filePath={state.filePath}
          variant={isPlanFile ? 'plan' : 'response'}
          embedded
        />
      )
    }

    case 'json': {
      let parsedData: unknown = null
      try {
        if (state.content) parsedData = JSON.parse(state.content)
      } catch {
        return (
          <CodePreviewOverlay
            isOpen
            onClose={onClose}
            filePath={state.filePath}
            content={state.content ?? ''}
            language="json"
            mode="read"
            theme={theme}
            error={state.error}
            embedded
          />
        )
      }
      return (
        <JSONPreviewOverlay
          isOpen
          onClose={onClose}
          filePath={state.filePath}
          title={state.filePath.split('/').pop() ?? 'JSON'}
          data={parsedData}
          theme={theme}
          error={state.error}
          embedded
        />
      )
    }

    case 'diff':
      return (
        <PreviewOverlay
          isOpen
          onClose={onClose}
          theme={theme}
          typeBadge={{
            icon: GitCompareArrows,
            label: 'Diff',
            variant: 'amber' as const,
          }}
          filePath={state.filePath}
          embedded
        >
          <ContentFrame title="Changes" fitContent minWidth={850}>
            <UnifiedDiffViewer
              unifiedDiff={state.unifiedDiff}
              filePath={state.filePath}
              theme={theme}
              disableFileHeader={false}
            />
          </ContentFrame>
        </PreviewOverlay>
      )

    default:
      return null
  }
}

function WorkflowTabContent({ tab }: { tab: WorkflowTab }) {
  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-3xl rounded-xl border border-border/40 bg-background p-4">
        <p className="text-sm font-medium text-foreground">{tab.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Workflow dispatched to this session.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Running in chat. See the main chat thread for live progress and results.
        </p>
      </div>
    </div>
  )
}

// ============================================================
// TurnTabContent — mirrors overlay rendering in ChatDisplay.tsx
// ============================================================

function TurnTabContent({
  tab,
  onClose,
  onOpenFile,
  onOpenUrl,
}: {
  tab: TurnTab
  onClose: () => void
  onOpenFile?: (path: string) => void
  onOpenUrl?: (url: string) => void
}) {
  const { isDark } = useTheme()
  const theme = isDark ? 'dark' : ('light' as const)
  const overlayState = tab.overlayState

  // For activity overlays, parse through extractOverlayData
  const overlayData: OverlayData | null = useMemo(() => {
    if (overlayState.type !== 'activity') return null
    return extractOverlayData(overlayState.activity)
  }, [overlayState])

  // Multi-diff overlay
  if (overlayState.type === 'multi-diff') {
    return (
      <MultiDiffPreviewOverlay
        isOpen
        onClose={onClose}
        changes={overlayState.changes}
        consolidated={overlayState.consolidated}
        focusedChangeId={overlayState.focusedChangeId}
        theme={theme}
        embedded
      />
    )
  }

  // Markdown overlay (pop-out, turn details)
  if (overlayState.type === 'markdown') {
    if (overlayState.forceCodeView) {
      return (
        <CodePreviewOverlay
          isOpen
          onClose={onClose}
          content={overlayState.content}
          filePath="response.md"
          language="markdown"
          mode="read"
          theme={theme}
          embedded
        />
      )
    }
    return (
      <DocumentFormattedMarkdownOverlay
        isOpen
        onClose={onClose}
        content={overlayState.content}
        onOpenUrl={onOpenUrl}
        onOpenFile={onOpenFile}
        embedded
      />
    )
  }

  // Activity-based overlays
  if (!overlayData) return null

  if (overlayData.type === 'code') {
    return (
      <CodePreviewOverlay
        isOpen
        onClose={onClose}
        content={overlayData.content}
        filePath={overlayData.filePath}
        mode={overlayData.mode}
        startLine={overlayData.startLine}
        totalLines={overlayData.totalLines}
        numLines={overlayData.numLines}
        theme={theme}
        error={overlayData.error}
        command={overlayData.command}
        embedded
      />
    )
  }

  if (overlayData.type === 'terminal') {
    return (
      <TerminalPreviewOverlay
        isOpen
        onClose={onClose}
        command={overlayData.command}
        output={overlayData.output}
        exitCode={overlayData.exitCode}
        toolType={overlayData.toolType}
        description={overlayData.description}
        theme={theme}
        error={overlayData.error}
        embedded
      />
    )
  }

  if (overlayData.type === 'json') {
    return (
      <JSONPreviewOverlay
        isOpen
        onClose={onClose}
        data={overlayData.data}
        title={overlayData.title}
        theme={theme}
        error={overlayData.error}
        embedded
      />
    )
  }

  if (overlayData.type === 'document') {
    const isPlanFile =
      overlayData.filePath &&
      (overlayData.filePath.includes('/plans/') || overlayData.filePath.startsWith('plans/')) &&
      overlayData.filePath.endsWith('.md')
    return (
      <DocumentFormattedMarkdownOverlay
        isOpen
        onClose={onClose}
        content={overlayData.content}
        filePath={overlayData.filePath}
        typeBadge={{ icon: PenLine, label: overlayData.toolName, variant: 'write' }}
        onOpenUrl={onOpenUrl}
        onOpenFile={onOpenFile}
        error={overlayData.error}
        variant={isPlanFile ? 'plan' : 'response'}
        embedded
      />
    )
  }

  if (overlayData.type === 'generic') {
    if (detectLanguage(overlayData.content) === 'markdown') {
      return (
        <DocumentFormattedMarkdownOverlay
          isOpen
          onClose={onClose}
          content={overlayData.content}
          onOpenUrl={onOpenUrl}
          onOpenFile={onOpenFile}
          error={overlayData.error}
          embedded
        />
      )
    }
    return (
      <GenericOverlay
        isOpen
        onClose={onClose}
        content={overlayData.content}
        title={overlayData.title}
        theme={theme}
        error={overlayData.error}
        embedded
      />
    )
  }

  return null
}
