/**
 * RichTextEditor.tsx — TipTap rich text editor wrapper (Phase 4, AC6 setup)
 *
 * Extensions: StarterKit, Link, Image, Placeholder, CharacterCount
 * Auto-saves every 30 seconds (debounced).
 */

import * as React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit     from '@tiptap/starter-kit'
import Link           from '@tiptap/extension-link'
import Image          from '@tiptap/extension-image'
import Placeholder    from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'

// ── Toolbar button ────────────────────────────────────────────────────────────

interface ToolbarBtnProps {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarBtn({ onClick, active, title, children }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        'h-7 px-2 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'hover:bg-muted text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface RichTextEditorProps {
  initialHtml?: string
  onChange: (html: string) => void
  onAutoSave?: (html: string) => void
  placeholder?: string
  readOnly?: boolean
}

export function RichTextEditor({
  initialHtml = '',
  onChange,
  onAutoSave,
  placeholder = 'Start writing…',
  readOnly = false,
}: RichTextEditorProps) {
  const autoSaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: initialHtml,
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML()
      onChange(html)
      // 30-second auto-save debounce
      if (onAutoSave) {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
        autoSaveTimer.current = setTimeout(() => onAutoSave(html), 30_000)
      }
    },
  })

  React.useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
  }, [])

  if (!editor) return null

  const charCount = editor.storage.characterCount?.characters?.() ?? 0
  const wordCount = editor.storage.characterCount?.words?.() ?? 0

  return (
    <div className="flex h-full flex-col border rounded-md overflow-hidden bg-background">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1 bg-muted/30">
          <ToolbarBtn title="Bold"       onClick={() => editor.chain().focus().toggleBold().run()}       active={editor.isActive('bold')}>B</ToolbarBtn>
          <ToolbarBtn title="Italic"     onClick={() => editor.chain().focus().toggleItalic().run()}     active={editor.isActive('italic')}><em>I</em></ToolbarBtn>
          <ToolbarBtn title="Strike"     onClick={() => editor.chain().focus().toggleStrike().run()}     active={editor.isActive('strike')}><s>S</s></ToolbarBtn>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolbarBtn title="H1"         onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>H1</ToolbarBtn>
          <ToolbarBtn title="H2"         onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</ToolbarBtn>
          <ToolbarBtn title="H3"         onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</ToolbarBtn>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolbarBtn title="Bullet list"    onClick={() => editor.chain().focus().toggleBulletList().run()}    active={editor.isActive('bulletList')}>• List</ToolbarBtn>
          <ToolbarBtn title="Ordered list"   onClick={() => editor.chain().focus().toggleOrderedList().run()}   active={editor.isActive('orderedList')}>1. List</ToolbarBtn>
          <ToolbarBtn title="Blockquote"     onClick={() => editor.chain().focus().toggleBlockquote().run()}    active={editor.isActive('blockquote')}>"</ToolbarBtn>
          <ToolbarBtn title="Code block"     onClick={() => editor.chain().focus().toggleCodeBlock().run()}     active={editor.isActive('codeBlock')}>&lt;/&gt;</ToolbarBtn>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolbarBtn title="Undo" onClick={() => editor.chain().focus().undo().run()}>↩</ToolbarBtn>
          <ToolbarBtn title="Redo" onClick={() => editor.chain().focus().redo().run()}>↪</ToolbarBtn>
        </div>
      )}

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="flex-1 overflow-auto px-4 py-3 prose prose-sm dark:prose-invert max-w-none focus:outline-none"
      />

      {/* Status bar */}
      <div className="flex items-center gap-3 border-t px-3 py-1 text-xs text-muted-foreground bg-muted/20">
        <span>{wordCount} words</span>
        <span>{charCount} chars</span>
      </div>
    </div>
  )
}
