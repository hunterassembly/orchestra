import * as React from 'react'
import { Node, Extension, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'

type TaskStatus = 'today' | 'upcoming' | 'anytime'

function normalizeStatus(value: string | undefined): TaskStatus {
  if (value === 'today' || value === 'upcoming' || value === 'anytime') return value
  return 'anytime'
}

function TiptapTaskCardView({
  node,
  updateAttributes,
}: {
  node: { attrs: { title?: string; dueDate?: string; assignee?: string; status?: string } }
  updateAttributes: (attrs: Record<string, unknown>) => void
}) {
  const status = normalizeStatus(node.attrs.status)

  return (
    <NodeViewWrapper className="tiptap-task-card" data-status={status}>
      <div className="tiptap-task-card__header">
        <input
          className="tiptap-task-card__title"
          value={node.attrs.title ?? ''}
          onChange={(event) => updateAttributes({ title: event.target.value })}
          placeholder="Task title"
        />
        <select
          className="tiptap-task-card__status"
          value={status}
          onChange={(event) => updateAttributes({ status: normalizeStatus(event.target.value) })}
        >
          <option value="today">Today</option>
          <option value="upcoming">Upcoming</option>
          <option value="anytime">Anytime</option>
        </select>
      </div>

      <div className="tiptap-task-card__meta">
        <label className="tiptap-task-card__meta-item">
          <span>Due</span>
          <input
            type="date"
            value={node.attrs.dueDate ?? ''}
            onChange={(event) => updateAttributes({ dueDate: event.target.value })}
          />
        </label>

        <label className="tiptap-task-card__meta-item">
          <span>Assignee</span>
          <input
            type="text"
            value={node.attrs.assignee ?? ''}
            onChange={(event) => updateAttributes({ assignee: event.target.value })}
            placeholder="Unassigned"
          />
        </label>
      </div>

      <div className="tiptap-task-card__description-label">Description</div>
      <NodeViewContent className="tiptap-task-card__description" />
    </NodeViewWrapper>
  )
}

export const TiptapTaskCard = Node.create({
  name: 'taskCard',
  group: 'block',
  content: 'block*',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      title: { default: '' },
      dueDate: { default: '' },
      assignee: { default: '' },
      status: { default: 'anytime' },
    }
  },
  parseHTML() {
    return [{ tag: 'task-card' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['task-card', mergeAttributes(HTMLAttributes), 0]
  },
  addNodeView() {
    return ReactNodeViewRenderer(TiptapTaskCardView)
  },
})

export const TiptapTaskSlashCommand = Extension.create({
  name: 'taskSlashCommand',
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { editor } = this
        const { state, view } = editor
        const { selection } = state
        if (!selection.empty) return false

        const { $from } = selection
        const parent = $from.parent
        if (!parent || !parent.isTextblock) return false

        const lineText = parent.textContent ?? ''
        const trimmed = lineText.trim()
        if (!trimmed.startsWith('/task')) return false

        const title = trimmed.replace(/^\/task\s*/i, '').trim()
        const insertPos = $from.start() - 1
        const paragraphNodeType = state.schema.nodes.paragraph
        if (!paragraphNodeType) return false

        const taskNode = state.schema.nodes.taskCard?.create(
          {
            title: title || 'New task',
            dueDate: '',
            assignee: '',
            status: 'anytime',
          },
          [paragraphNodeType.create()],
        )

        if (!taskNode) return false

        const tr = state.tr.replaceWith(insertPos, insertPos + parent.nodeSize, taskNode)
        const paragraphAfter = paragraphNodeType.create()
        tr.insert(insertPos + taskNode.nodeSize, paragraphAfter)
        tr.setSelection(TextSelection.create(tr.doc, insertPos + taskNode.nodeSize + 1))
        view.dispatch(tr.scrollIntoView())
        return true
      },
    }
  },
})
