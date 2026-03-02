/**
 * DocumentFormattedMarkdownOverlay - Fullscreen view for reading AI responses and plans
 *
 * Renders markdown content in a document-like format with:
 * - Centered content card with max-width
 * - Copy button via FullscreenOverlayBase's built-in copyContent prop
 * - Optional "Plan" header variant
 * - Optional filePath badge with dual-trigger menu (Open / Reveal in {file manager})
 *
 * Background and scenic blur are provided by FullscreenOverlayBase.
 * Uses FullscreenOverlayBase for portal, traffic lights, ESC handling, and header.
 */

import { ListTodo } from 'lucide-react'
import { Markdown } from '../markdown'
import { FullscreenOverlayBase } from './FullscreenOverlayBase'
import { FullscreenOverlayBaseHeader, type OverlayTypeBadge } from './FullscreenOverlayBaseHeader'

export interface DocumentFormattedMarkdownOverlayProps {
  /** The content to display (markdown) */
  content: string
  /** Whether the overlay is open */
  isOpen: boolean
  /** Called when overlay should close */
  onClose: () => void
  /** Variant: 'response' (default) or 'plan' (shows header) */
  variant?: 'response' | 'plan'
  /** Callback for URL clicks */
  onOpenUrl?: (url: string) => void
  /** Callback for file path clicks */
  onOpenFile?: (path: string) => void
  /** Optional file path — shows badge with "Open" / "Reveal in {file manager}" menu */
  filePath?: string
  /** Optional type badge — tool/format indicator (e.g. "Write") shown in header */
  typeBadge?: OverlayTypeBadge
  /** Optional error message — renders a tinted error banner above the content card */
  error?: string
  /** Render inline (no dialog/portal) — for embedding in tab content */
  embedded?: boolean
}

/** Shared content card used by both fullscreen and embedded modes */
function DocumentContent({
  content,
  variant = 'response',
  onOpenUrl,
  onOpenFile,
}: {
  content: string
  variant?: 'response' | 'plan'
  onOpenUrl?: (url: string) => void
  onOpenFile?: (path: string) => void
}) {
  return (
    <div className="bg-background rounded-[16px] shadow-strong w-full max-w-[960px] h-fit mx-auto my-auto">
      {/* Plan header (variant="plan" only) */}
      {variant === 'plan' && (
        <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 rounded-t-[16px]">
          <ListTodo className="w-3 h-3 text-success" />
          <span className="text-[13px] font-medium text-success">Plan</span>
        </div>
      )}

      {/* Content area */}
      <div className="px-10 pt-8 pb-8">
        <div className="text-sm">
          <Markdown
            mode="minimal"
            onUrlClick={onOpenUrl}
            onFileClick={onOpenFile}
            hideFirstMermaidExpand={false}
          >
            {content}
          </Markdown>
        </div>
      </div>
    </div>
  )
}

export function DocumentFormattedMarkdownOverlay({
  content,
  isOpen,
  onClose,
  variant = 'response',
  onOpenUrl,
  onOpenFile,
  filePath,
  typeBadge,
  error,
  embedded = false,
}: DocumentFormattedMarkdownOverlayProps) {
  // Embedded mode — render inline without dialog/portal
  if (embedded) {
    return (
      <div className="flex flex-col bg-background h-full w-full overflow-hidden">
        <FullscreenOverlayBaseHeader
          onClose={onClose}
          filePath={filePath}
          typeBadge={typeBadge}
        />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="min-h-full flex flex-col justify-center px-6 py-8">
            <DocumentContent content={content} variant={variant} onOpenUrl={onOpenUrl} onOpenFile={onOpenFile} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <FullscreenOverlayBase
      isOpen={isOpen}
      onClose={onClose}
      filePath={filePath}
      typeBadge={typeBadge}
      copyContent={content}
      error={error ? { label: 'Write Failed', message: error } : undefined}
    >
      {/* Content wrapper — min-h-full for vertical centering within FullscreenOverlayBase's scroll container.
          Scrolling and gradient fade mask are handled by FullscreenOverlayBase. */}
      <div className="min-h-full flex flex-col justify-center px-6 py-16">
        <DocumentContent content={content} variant={variant} onOpenUrl={onOpenUrl} onOpenFile={onOpenFile} />
      </div>
    </FullscreenOverlayBase>
  )
}
