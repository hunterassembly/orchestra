/**
 * File-type icons for the workspace file tree.
 * Small colored badge/symbol icons that indicate file type at a glance.
 */

import * as React from 'react'
import { File, Folder, FolderOpen } from 'lucide-react'

const ICON_SIZE = 16

// ============================================================
// Badge-style icons (colored text on rounded rect background)
// ============================================================

function BadgeIcon({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="10" rx="2" fill={bg} />
      <text
        x="8"
        y="10.5"
        textAnchor="middle"
        fill={fg}
        fontSize="7"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {text}
      </text>
    </svg>
  )
}

// ============================================================
// Specific file-type icons
// ============================================================

function MarkdownIcon() {
  return <BadgeIcon text="MD" bg="#8B6914" fg="#fff" />
}

function TypeScriptIcon() {
  return <BadgeIcon text="TS" bg="#3178C6" fg="#fff" />
}

function JavaScriptIcon() {
  return <BadgeIcon text="JS" bg="#F0DB4F" fg="#323330" />
}

function JsonIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="10" rx="2" fill="#5B9A32" />
      <text
        x="8"
        y="10.5"
        textAnchor="middle"
        fill="#fff"
        fontSize="5.5"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {'{ }'}
      </text>
    </svg>
  )
}

function GitIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 2L12.5 8L8 14L3.5 8L8 2Z"
        fill="#E84D31"
        stroke="#E84D31"
        strokeWidth="0.5"
      />
    </svg>
  )
}

function ConfigIcon() {
  return (
    <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="#888" strokeWidth="1.5" fill="none" />
      <circle cx="8" cy="8" r="1" fill="#888" />
      {/* Gear teeth */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180
        const x1 = 8 + Math.cos(rad) * 4.2
        const y1 = 8 + Math.sin(rad) * 4.2
        const x2 = 8 + Math.cos(rad) * 5.8
        const y2 = 8 + Math.sin(rad) * 5.8
        return (
          <line
            key={angle}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#888"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

function CssIcon() {
  return <BadgeIcon text="CSS" bg="#264DE4" fg="#fff" />
}

function HtmlIcon() {
  return <BadgeIcon text="HTM" bg="#E44D26" fg="#fff" />
}

function PythonIcon() {
  return <BadgeIcon text="PY" bg="#3776AB" fg="#FFD43B" />
}

function RubyIcon() {
  return <BadgeIcon text="RB" bg="#CC342D" fg="#fff" />
}

function RustIcon() {
  return <BadgeIcon text="RS" bg="#DEA584" fg="#000" />
}

function GoIcon() {
  return <BadgeIcon text="GO" bg="#00ADD8" fg="#fff" />
}

// ============================================================
// Icon resolver
// ============================================================

/**
 * Returns a file-type-specific icon for the given filename.
 * Falls back to generic File icon from Lucide.
 */
export function getFileTypeIcon(
  filename: string,
  type: 'file' | 'directory',
  isExpanded?: boolean,
) {
  const iconClass = 'h-4 w-4 text-muted-foreground'

  if (type === 'directory') {
    return isExpanded
      ? <FolderOpen className={iconClass} />
      : <Folder className={iconClass} />
  }

  const ext = filename.split('.').pop()?.toLowerCase()
  const lowerName = filename.toLowerCase()

  // Special filenames
  if (lowerName === '.gitignore' || lowerName === '.gitattributes' || lowerName === '.gitmodules') {
    return <GitIcon />
  }

  // Extension-based
  switch (ext) {
    case 'md':
    case 'markdown':
    case 'mdx':
      return <MarkdownIcon />

    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return <TypeScriptIcon />

    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return <JavaScriptIcon />

    case 'json':
    case 'jsonc':
    case 'json5':
      return <JsonIcon />

    case 'toml':
    case 'yml':
    case 'yaml':
    case 'ini':
    case 'cfg':
    case 'conf':
      return <ConfigIcon />

    case 'css':
    case 'scss':
    case 'less':
    case 'sass':
      return <CssIcon />

    case 'html':
    case 'htm':
      return <HtmlIcon />

    case 'py':
      return <PythonIcon />

    case 'rb':
    case 'erb':
      return <RubyIcon />

    case 'rs':
      return <RustIcon />

    case 'go':
      return <GoIcon />

    default:
      return <File className={iconClass} />
  }
}
