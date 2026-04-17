import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { StarterKit } from '@tiptap/starter-kit'
import { Link } from '@tiptap/extension-link'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Bold as BoldIcon, Italic as ItalicIcon, Strikethrough, Code as CodeIcon, List, ListOrdered, Link2 } from 'lucide-react'
import { cn } from '@/lib/cn'

interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  onBlur?: () => void
  onKeyDown?: (e: KeyboardEvent) => boolean | void
  onPaste?: (e: ClipboardEvent) => boolean | void
  placeholder?: string
  editorRef?: React.MutableRefObject<Editor | null>
  onReady?: (normalizedHtml: string) => void
  autoFocus?: boolean
  className?: string
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  onKeyDown,
  onPaste,
  placeholder,
  editorRef,
  onReady,
  autoFocus,
  className,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onKeyDownRef = useRef(onKeyDown)
  const onPasteRef = useRef(onPaste)
  const onReadyRef = useRef(onReady)
  onChangeRef.current = onChange
  onBlurRef.current = onBlur
  onKeyDownRef.current = onKeyDown
  onPasteRef.current = onPaste
  onReadyRef.current = onReady

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'min-h-[18px]',
          className,
        ),
      },
      handleKeyDown: (_view, event) => {
        const result = onKeyDownRef.current?.(event)
        return result === true
      },
      handlePaste: (_view, event) => {
        const result = onPasteRef.current?.(event)
        return result === true
      },
    },
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getHTML())
    },
    onBlur: () => {
      onBlurRef.current?.()
    },
    onCreate: ({ editor: e }) => {
      onReadyRef.current?.(e.getHTML())
    },
  })

  useEffect(() => {
    if (editorRef) editorRef.current = editor
    return () => {
      if (editorRef) editorRef.current = null
    }
  }, [editor, editorRef])

  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [value, editor])

  if (!editor) return null

  return (
    <>
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 shadow-md"
      >
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="Bold (Ctrl+B)"
        >
          <BoldIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="Italic (Ctrl+I)"
        >
          <ItalicIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          title="Inline code"
        >
          <CodeIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-[var(--border-color)]" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px bg-[var(--border-color)]" />
        <ToolbarButton
          onClick={() => {
            const prev = editor.getAttributes('link').href as string | undefined
            const url = window.prompt('Link URL', prev ?? 'https://')
            if (url === null) return
            if (url === '') {
              editor.chain().focus().unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          title="Link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarButton>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  )
}

interface ToolbarButtonProps {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      title={title}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded transition-colors',
        active
          ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      {children}
    </button>
  )
}
