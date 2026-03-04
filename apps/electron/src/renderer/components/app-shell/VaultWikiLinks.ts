export interface ParsedWikiLink {
  raw: string
  target: string
  display: string
}

export interface WikiNoteRef {
  relativePath: string
  title: string
}

function stripMarkdownExt(value: string): string {
  return value.replace(/\.(md|markdown)$/i, '')
}

function normalizeKey(value: string): string {
  return stripMarkdownExt(value)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase()
}

function toSlugish(value: string): string {
  return normalizeKey(value)
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Parse [[wiki links]] from markdown.
 * Supports:
 * - [[Note]]
 * - [[path/to/note]]
 * - [[Note|Alias]]
 * - [[Note#Heading]]
 * - [[Note^block-id]]
 */
export function parseWikiLinks(markdown: string): ParsedWikiLink[] {
  const matches = markdown.match(/\[\[([^\]]+)\]\]/g) || []
  return matches
    .map((raw) => {
      const inner = raw.replace(/^\[\[|\]\]$/g, '').trim()
      if (!inner) return null
      const [left, alias] = inner.split('|')
      const targetWithoutAnchor = (left || '').split('#')[0].split('^')[0].trim()
      if (!targetWithoutAnchor) return null
      return {
        raw,
        target: targetWithoutAnchor,
        display: (alias || targetWithoutAnchor).trim(),
      } satisfies ParsedWikiLink
    })
    .filter((item): item is ParsedWikiLink => Boolean(item))
}

export function buildNoteMatchKeys(noteRelativePath: string, noteTitle: string): Set<string> {
  const keys = new Set<string>()
  const rel = normalizeKey(noteRelativePath)
  const relSlug = toSlugish(noteRelativePath)
  const title = normalizeKey(noteTitle)
  const titleSlug = toSlugish(noteTitle)
  const base = normalizeKey(rel.split('/').pop() || '')
  const baseSlug = toSlugish(base)

  for (const key of [rel, relSlug, title, titleSlug, base, baseSlug]) {
    if (key) keys.add(key)
  }
  return keys
}

export function linkTargetMatchesNote(linkTarget: string, matchKeys: Set<string>): boolean {
  const target = normalizeKey(linkTarget)
  const targetSlug = toSlugish(linkTarget)
  return matchKeys.has(target) || matchKeys.has(targetSlug)
}

export function wikiLinksToMarkdownLinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (full, innerRaw) => {
    const inner = String(innerRaw || '').trim()
    if (!inner) return full
    const [targetRaw, aliasRaw] = inner.split('|')
    const target = String(targetRaw || '').trim()
    if (!target) return full
    const label = String(aliasRaw || target).trim() || target
    const href = `note://${encodeURIComponent(target)}`
    return `[${label}](${href})`
  })
}

export function markdownLinksToWikiLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\(note:\/\/([^)]+)\)/g, (_full, labelRaw, encodedTargetRaw) => {
    const label = String(labelRaw || '').trim()
    const encodedTarget = String(encodedTargetRaw || '').trim()
    if (!encodedTarget) return _full
    let target = encodedTarget
    try {
      target = decodeURIComponent(encodedTarget)
    } catch {
      // keep encoded target as fallback
    }
    if (!label || label.toLowerCase() === target.toLowerCase()) {
      return `[[${target}]]`
    }
    return `[[${target}|${label}]]`
  })
}

export function resolveWikiTargetToRelativePath(target: string, notes: WikiNoteRef[]): string | null {
  if (!target.trim()) return null
  for (const note of notes) {
    const keys = buildNoteMatchKeys(note.relativePath, note.title)
    if (linkTargetMatchesNote(target, keys)) {
      return note.relativePath
    }
  }
  return null
}
