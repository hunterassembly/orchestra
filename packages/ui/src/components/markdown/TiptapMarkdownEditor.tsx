import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { TextSelection } from '@tiptap/pm/state'
import { CheckSquare2 } from 'lucide-react'
import { tiptapCodeBlock } from './TiptapCodeBlockView'
import { TiptapTaskCard, TiptapTaskSlashCommand } from './TiptapTaskCard'
import { cn } from '../../lib/utils'
import 'katex/dist/katex.min.css'
import './tiptap-editor.css'

function getMarkdown(editor: unknown): string {
  const markdownStorage = (editor as { storage?: { markdown?: MarkdownStorage } })?.storage?.markdown
  return markdownStorage?.getMarkdown() ?? ''
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
}

export function TiptapMarkdownEditor({
  content,
  onUpdate,
  placeholder = 'Write something...',
  className,
  editable = true,
}: TiptapMarkdownEditorProps) {
  const onUpdateRef = React.useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const [slashOpen, setSlashOpen] = React.useState(false)
  const [slashFilter, setSlashFilter] = React.useState('')
  const [slashPos, setSlashPos] = React.useState({ x: 0, y: 0 })
  const [slashRange, setSlashRange] = React.useState<{ from: number; to: number } | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      tiptapCodeBlock.configure({
        themes: { light: 'github-light', dark: 'github-dark' },
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

    const handleKeyDown = (event: KeyboardEvent) => {
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
  }, [editor, slashOpen, slashRange, insertTaskCardAtRange])

  return (
    <div className={cn('tiptap-editor', className)}>
      <EditorContent editor={editor} />
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
    </div>
  )
}
