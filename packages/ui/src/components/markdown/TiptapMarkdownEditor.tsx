import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { TextSelection } from '@tiptap/pm/state'
import { CheckSquare2, GripVertical } from 'lucide-react'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { TiptapTaskCard, TiptapTaskSlashCommand } from './TiptapTaskCard'
import { cn } from '../../lib/utils'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'

function getMarkdown(editor: unknown): string {
  const markdownStorage = (editor as { storage?: { markdown?: MarkdownStorage } })?.storage?.markdown
  return markdownStorage?.getMarkdown() ?? ''
}

function getTopLevelNodeStartPos(doc: { forEach: (cb: (node: { nodeSize: number }, offset: number) => void) => void }, pos: number): number | null {
  let found: number | null = null
  doc.forEach((node, offset) => {
    if (found !== null) return
    const from = offset
    const to = offset + node.nodeSize
    if (pos >= from && pos < to) {
      found = from
    }
  })
  return found
}

function getBlockDomFromPoint(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  return target.closest(
    '.tiptap-prose p, .tiptap-prose h1, .tiptap-prose h2, .tiptap-prose h3, .tiptap-prose ul, .tiptap-prose ol, .tiptap-prose blockquote, .tiptap-prose pre, .tiptap-prose hr, .tiptap-prose .tiptap-task-card',
  )
}

export interface TiptapMarkdownEditorProps {
  /** Markdown string content */
  content: string
  /** Called when content changes (debounced on blur or cmd+s) */
  onUpdate?: (markdown: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  className?: string
  /** Whether the editor is editable */
  editable?: boolean
  /** Optional wiki-link suggestions shown when typing [[ */
  wikiLinkSuggestions?: Array<{ label: string; value?: string; subtitle?: string }>
  /** Called when a rendered wiki link (note://...) is clicked. */
  onWikiLinkNavigate?: (target: string) => void
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder = 'Write something...',
  className,
  editable = true,
  wikiLinkSuggestions = [],
  onWikiLinkNavigate,
}: TiptapMarkdownEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const [slashOpen, setSlashOpen] = React.useState(false)
  const [slashFilter, setSlashFilter] = React.useState('')
  const [slashPos, setSlashPos] = React.useState({ x: 0, y: 0 })
  const [slashRange, setSlashRange] = React.useState<{ from: number; to: number } | null>(null)
  const [wikiOpen, setWikiOpen] = React.useState(false)
  const [wikiFilter, setWikiFilter] = React.useState('')
  const [wikiPos, setWikiPos] = React.useState({ x: 0, y: 0 })
  const [wikiRange, setWikiRange] = React.useState<{ from: number; to: number } | null>(null)
  const [wikiSelectedIndex, setWikiSelectedIndex] = React.useState(0)
  const [hoveredBlock, setHoveredBlock] = React.useState<{ pos: number; top: number; height: number } | null>(null)
  const [dropIndicatorY, setDropIndicatorY] = React.useState<number | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const draggingBlockPosRef = React.useRef<number | null>(null)

  const filteredWikiSuggestions = React.useMemo(() => {
    const q = wikiFilter.trim().toLowerCase()
    const filtered = q.length === 0
      ? wikiLinkSuggestions
      : wikiLinkSuggestions.filter((item) =>
        item.label.toLowerCase().includes(q) ||
        (item.value || item.label).toLowerCase().includes(q) ||
        (item.subtitle || '').toLowerCase().includes(q),
      )
    return filtered.slice(0, 8)
  }, [wikiFilter, wikiLinkSuggestions])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      tiptapCodeBlock.configure({
        themes: { light: 'github-light', dark: 'github-dark' },
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
      }),
      TiptapTaskCard,
      TiptapTaskSlashCommand,
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap-prose outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor)
      onUpdateRef.current?.(md)
    },
  }, [])

  // Sync editable prop
  React.useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
  }, [editor, editable])

  // Sync content when the selected task changes (key prop handles this,
  // but as a safety net for direct content prop changes)
  const prevContentRef = React.useRef(content)
  React.useEffect(() => {
    if (editor && content !== prevContentRef.current) {
      prevContentRef.current = content
      const currentMd = getMarkdown(editor)
      if (currentMd !== content) {
        editor.commands.setContent(content)
      }
    }
  }, [editor, content])

  const insertTaskCardAtRange = React.useCallback((range: { from: number; to: number } | null) => {
    if (!editor || !range) return
    const { state, view } = editor
    const taskNodeType = state.schema.nodes.taskCard
    const paragraphNodeType = state.schema.nodes.paragraph
    if (!taskNodeType || !paragraphNodeType) return

    const taskNode = taskNodeType.create(
      { title: 'New task', dueDate: '', assignee: '', status: 'anytime' },
      [paragraphNodeType.create()],
    )

    const tr = state.tr.replaceWith(range.from, range.to, taskNode)
    tr.insert(range.from + taskNode.nodeSize, paragraphNodeType.create())
    tr.setSelection(TextSelection.create(tr.doc, range.from + taskNode.nodeSize + 1))
    view.dispatch(tr.scrollIntoView())

    setSlashOpen(false)
    setSlashRange(null)
    setSlashFilter('')
  }, [editor])

  const insertWikiLinkAtRange = React.useCallback(
    (range: { from: number; to: number } | null, suggestion?: { label: string; value?: string }) => {
      if (!editor || !range) return
      const target = suggestion ? (suggestion.value || suggestion.label) : wikiFilter.trim()
      const safeTarget = target.replace(/\]\]/g, '').trim()
      if (!safeTarget) return
      const insertion = `[[${safeTarget}]]`
      editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, insertion).run()
      setWikiOpen(false)
      setWikiRange(null)
      setWikiFilter('')
      setWikiSelectedIndex(0)
    },
    [editor, wikiFilter],
  )

  React.useEffect(() => {
    if (!editor) return

    const updateSlashState = () => {
      const { state, view } = editor
      const { selection } = state
      if (!selection.empty) {
        setSlashOpen(false)
        setSlashRange(null)
        setSlashFilter('')
        return
      }

      const { $from } = selection
      const textBeforeCursor = $from.parent.textContent.slice(0, $from.parentOffset)

      const wikiMatch = textBeforeCursor.match(/\[\[([^\]\n]*)$/)
      if (wikiMatch) {
        const filterText = wikiMatch[1] || ''
        const wikiStart = textBeforeCursor.lastIndexOf('[[')
        const from = $from.start() + wikiStart
        const to = selection.from
        const coords = view.coordsAtPos(selection.from)
        setWikiPos({ x: coords.left, y: coords.bottom })
        setWikiRange({ from, to })
        setWikiFilter(filterText)
        setWikiOpen(true)
        setSlashOpen(false)
        setSlashRange(null)
        setSlashFilter('')
        return
      }

      setWikiOpen(false)
      setWikiRange(null)
      setWikiFilter('')
      setWikiSelectedIndex(0)

      const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([\w-]*)$/)
      if (!slashMatch) {
        setSlashOpen(false)
        setSlashRange(null)
        setSlashFilter('')
        return
      }

      const filterText = slashMatch[1] || ''
      if (!'task'.startsWith(filterText.toLowerCase())) {
        setSlashOpen(false)
        setSlashRange(null)
        setSlashFilter(filterText)
        return
      }

      const slashIndex = textBeforeCursor.lastIndexOf('/')
      const from = $from.start() + slashIndex
      const to = selection.from
      const coords = view.coordsAtPos(selection.from)
      setSlashPos({ x: coords.left, y: coords.bottom })
      setSlashRange({ from, to })
      setSlashFilter(filterText)
      setSlashOpen(true)
    }

    const closeSlash = () => {
      setSlashOpen(false)
      setSlashRange(null)
      setSlashFilter('')
    }
    const closeWiki = () => {
      setWikiOpen(false)
      setWikiRange(null)
      setWikiFilter('')
      setWikiSelectedIndex(0)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (wikiOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeWiki()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setWikiSelectedIndex((idx) => Math.min(idx + 1, Math.max(filteredWikiSuggestions.length - 1, 0)))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setWikiSelectedIndex((idx) => Math.max(idx - 1, 0))
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          const selected = filteredWikiSuggestions[wikiSelectedIndex]
          insertWikiLinkAtRange(wikiRange, selected)
          return
        }
      }

      if (!slashOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSlash()
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insertTaskCardAtRange(slashRange)
      }
    }

    editor.on('update', updateSlashState)
    editor.on('selectionUpdate', updateSlashState)
    document.addEventListener('keydown', handleKeyDown)
    updateSlashState()

    return () => {
      editor.off('update', updateSlashState)
      editor.off('selectionUpdate', updateSlashState)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [editor, slashOpen, slashRange, insertTaskCardAtRange, wikiOpen, wikiRange, filteredWikiSuggestions, wikiSelectedIndex, insertWikiLinkAtRange])

  React.useEffect(() => {
    setWikiSelectedIndex(0)
  }, [wikiFilter, wikiOpen])

  const resolveBlockPosFromElement = React.useCallback((blockEl: HTMLElement): number | null => {
    if (!editor) return null
    try {
      const domPos = editor.view.posAtDOM(blockEl, 0)
      return getTopLevelNodeStartPos(editor.state.doc, domPos)
    } catch {
      return null
    }
  }, [editor])

  const handleEditorMouseMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || !editable) return
    const blockEl = getBlockDomFromPoint(event.target)
    if (!blockEl || !wrapperRef.current?.contains(blockEl)) {
      setHoveredBlock(null)
      return
    }
    const pos = resolveBlockPosFromElement(blockEl)
    if (pos === null) {
      setHoveredBlock(null)
      return
    }
    const wrapperRect = wrapperRef.current.getBoundingClientRect()
    const rect = blockEl.getBoundingClientRect()
    setHoveredBlock({
      pos,
      top: rect.top - wrapperRect.top,
      height: rect.height,
    })
  }, [editor, editable, resolveBlockPosFromElement])

  const handleEditorMouseLeave = React.useCallback(() => {
    setHoveredBlock(null)
  }, [])

  const onHandleDragStart = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!editor || !hoveredBlock) return
    draggingBlockPosRef.current = hoveredBlock.pos
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `block:${hoveredBlock.pos}`)
    const from = hoveredBlock.pos
    const node = editor.state.doc.nodeAt(from)
    if (!node) return
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, Math.max(1, from + 1)))
    editor.view.dispatch(tr)
  }, [editor, hoveredBlock])

  const onEditorDragOver = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!editor || draggingBlockPosRef.current === null) return
    event.preventDefault()
    const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
    if (typeof pos !== 'number') {
      setDropIndicatorY(null)
      return
    }
    const targetStart = getTopLevelNodeStartPos(editor.state.doc, pos)
    if (targetStart === null) {
      setDropIndicatorY(null)
      return
    }
    const node = editor.state.doc.nodeAt(targetStart)
    if (!node) {
      setDropIndicatorY(null)
      return
    }
    const coords = editor.view.coordsAtPos(Math.max(1, targetStart + 1))
    const nodeMidY = coords.top + Math.max(12, node.nodeSize) / 2
    const insertAfter = event.clientY > nodeMidY
    setDropIndicatorY(insertAfter ? coords.bottom : coords.top)
  }, [editor])

  const onEditorDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!editor) return
    const draggedFrom = draggingBlockPosRef.current
    draggingBlockPosRef.current = null
    setDropIndicatorY(null)
    if (draggedFrom === null) return

    event.preventDefault()
    const posAtCoords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
    if (typeof posAtCoords !== 'number') return

    const state = editor.state
    const draggedNode = state.doc.nodeAt(draggedFrom)
    if (!draggedNode) return

    const targetStart = getTopLevelNodeStartPos(state.doc, posAtCoords)
    if (targetStart === null) return
    const targetNode = state.doc.nodeAt(targetStart)
    if (!targetNode) return

    const targetCoords = editor.view.coordsAtPos(Math.max(1, targetStart + 1))
    const insertAfterTarget = event.clientY > ((targetCoords.top + targetCoords.bottom) / 2)
    let insertPos = insertAfterTarget ? targetStart + targetNode.nodeSize : targetStart

    if (insertPos >= draggedFrom && insertPos <= draggedFrom + draggedNode.nodeSize) {
      return
    }

    let tr = state.tr.delete(draggedFrom, draggedFrom + draggedNode.nodeSize)
    if (insertPos > draggedFrom) insertPos -= draggedNode.nodeSize
    tr = tr.insert(insertPos, draggedNode)
    editor.view.dispatch(tr.scrollIntoView())
  }, [editor])

  const onEditorDragEnd = React.useCallback(() => {
    draggingBlockPosRef.current = null
    setDropIndicatorY(null)
  }, [])

  const onEditorClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!onWikiLinkNavigate) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const linkEl = target.closest('a[href^="note://"]') as HTMLAnchorElement | null
    if (!linkEl) return
    event.preventDefault()
    const href = linkEl.getAttribute('href') || ''
    const encoded = href.replace(/^note:\/\//, '')
    let decoded = encoded
    try {
      decoded = decodeURIComponent(encoded)
    } catch {
      // noop
    }
    onWikiLinkNavigate(decoded)
  }, [onWikiLinkNavigate])

  return (
    <div
      ref={wrapperRef}
      className={cn('tiptap-editor', className)}
      onMouseMove={handleEditorMouseMove}
      onMouseLeave={handleEditorMouseLeave}
      onDragOver={onEditorDragOver}
      onDrop={onEditorDrop}
      onDragEnd={onEditorDragEnd}
      onClick={onEditorClick}
    >
      <EditorContent editor={editor} />
      {editable && hoveredBlock && (
        <button
          type="button"
          draggable
          className="tiptap-drag-handle"
          style={{ top: hoveredBlock.top + 2 }}
          onDragStart={onHandleDragStart}
          title="Drag block"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      {dropIndicatorY !== null && (
        <div
          className="tiptap-drop-indicator"
          style={{ top: dropIndicatorY }}
        />
      )}
      {slashOpen && (
        <div
          className="tiptap-slash-menu"
          style={{
            left: Math.round(slashPos.x - 10),
            top: Math.round(slashPos.y + 8),
          }}
        >
          <div className="tiptap-slash-menu__section">Commands</div>
          <button
            type="button"
            className="tiptap-slash-menu__item"
            onMouseDown={(event) => {
              event.preventDefault()
              insertTaskCardAtRange(slashRange)
            }}
          >
            <CheckSquare2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">/task</span>
            <span className="text-muted-foreground">Create a rich task card</span>
            <kbd className="tiptap-slash-menu__kbd">↵</kbd>
          </button>
          {slashFilter.length > 0 && slashFilter !== 'task' && (
            <div className="tiptap-slash-menu__hint">Filter: {slashFilter}</div>
          )}
        </div>
      )}
      {wikiOpen && (
        <div
          className="tiptap-slash-menu"
          style={{
            left: Math.round(wikiPos.x - 10),
            top: Math.round(wikiPos.y + 8),
          }}
        >
          <div className="tiptap-slash-menu__section">Link to note</div>
          {filteredWikiSuggestions.length > 0 ? (
            filteredWikiSuggestions.map((item, index) => (
              <button
                key={`${item.value || item.label}-${index}`}
                type="button"
                className={cn('tiptap-slash-menu__item', index === wikiSelectedIndex && 'tiptap-slash-menu__item--active')}
                onMouseDown={(event) => {
                  event.preventDefault()
                  insertWikiLinkAtRange(wikiRange, item)
                }}
              >
                <span className="text-muted-foreground text-[11px]">[[</span>
                <span className="font-medium truncate">{item.label}</span>
                <span className="text-muted-foreground text-[11px] truncate">{item.subtitle || item.value || ''}</span>
                <kbd className="tiptap-slash-menu__kbd">↵</kbd>
              </button>
            ))
          ) : (
            <div className="tiptap-slash-menu__hint">
              Press Enter to create <code>{`[[${wikiFilter || 'Note'}]]`}</code>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
