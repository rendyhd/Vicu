import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Bell, BellOff, Pencil, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  applyMention,
  decodeCommentHtml,
  displayName,
  encodeCommentHtml,
  isCommentEdited,
  mentionQueryAt,
  mentionSuggestions,
  visibleToText,
  type MentionQuery,
} from '@/lib/collaboration'
import { formatDateDisplay } from '@/lib/date-display'
import { localDayKey } from '@/lib/freshness'
import { useDateFormat } from '@/hooks/use-date-format'
import { useAppConfig } from '@/hooks/use-app-config'
import { useDayKey } from '@/stores/day-store'
import { useUIStore } from '@/stores/ui-store'
import { commentDraft, commentsButtonId, saveCommentDraft, useCommentsPaneStore } from '@/stores/comments-pane-store'
import { useCollabMe, useProjectAccess, type ProjectAccess } from '@/hooks/use-project-access'
import {
  isSendingComment,
  useCreateComment,
  useDeleteComment,
  useMarkTaskRead,
  useTaskComments,
  useTaskSubscription,
  useUpdateComment,
} from '@/hooks/use-task-comments'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Avatar, AvatarStack } from '@/components/shared/Avatar'
import { buttonClasses } from '@/components/shared/Button'
import { Popover } from '@/components/overlay/Popover'
import { Tooltip } from '@/components/overlay/Tooltip'
import { AttachmentViewer } from '@/components/task-list/AttachmentViewer'
import { commentAttachmentsOf, commentBlocks, filesToAttach, pastedFiles, viewerImagesOf, type CommentFileList, type TextSegment } from '@/lib/comment-files'
import { useCommentFileList, useCommentFiles } from '@/hooks/use-comment-files'
import type { CommentAttachment } from '@/lib/collaboration'
import type { PersonRef, Task, TaskComment } from '@/lib/vikunja-types'
import { AttachButton, CommentFile, CommentImage, StagedFiles } from './CommentFiles'

// The comments pane (collaboration D3): a third column right of the content region that follows the
// open card. It shows while a card is open and the pane is on (sticky for the session); it reads
// like a document, oldest first, with day dividers, and opens scrolled to the end.

/** Older pages load when the thread is scrolled this close to its top. */
const LOAD_OLDER_THRESHOLD_PX = 48
/** While the pane is open its thread is read again this often (comments are never pushed). */
const THREAD_REFRESH_MS = 60_000

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** Keys the task list acts on from anywhere on the page; inside the pane they belong to the pane. */
function isListShortcut(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey
  if (mod && ['a', 'k', 't', 'v', 'n', 'Enter'].includes(e.key)) return true
  return e.key === 'Delete' || e.key === 'Backspace' || e.key === '!'
}

export function CommentsPaneHost() {
  const open = useUIStore((s) => s.commentsPaneOpen)
  const task = useCommentsPaneStore((s) => s.task)
  const access = useProjectAccess(task?.project_id)
  const me = useCollabMe()
  const available = !!task
  const [focusComposer, setFocusComposer] = useState(0)

  // Mod+Shift+C shows or hides the pane while a card is open.
  useEffect(() => {
    if (!available) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.isComposing || e.key.toLowerCase() !== 'c') return
      e.preventDefault()
      e.stopPropagation()
      const ui = useUIStore.getState()
      if (ui.commentsPaneOpen) {
        ui.setCommentsPaneOpen(false)
        if (task) document.getElementById(commentsButtonId(task.id))?.focus()
      } else {
        ui.setCommentsPaneOpen(true)
        setFocusComposer((n) => n + 1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [available, task])

  if (!open || !task) return null

  const close = () => {
    useUIStore.getState().setCommentsPaneOpen(false)
    document.getElementById(commentsButtonId(task.id))?.focus()
  }

  return (
    <aside
      id="comments-pane"
      aria-label="Comments"
      className="vicu-pane-in flex w-[352px] shrink-0 flex-col overflow-hidden border-l border-[var(--border-color)] bg-[var(--bg-sidebar)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          e.stopPropagation()
          close()
          return
        }
        if (isListShortcut(e)) e.stopPropagation()
      }}
    >
      {/* The title band: the window controls and the drag region sit over it. */}
      <div className="h-8 shrink-0" />
      <CommentsThread key={task.id} task={task} access={access} me={me} onClose={close} focusComposer={focusComposer} />
    </aside>
  )
}

interface ThreadProps {
  task: Task
  access: ProjectAccess
  me: PersonRef | null
  onClose: () => void
  /** Bumped to move focus into the composer (the pane was opened from the keyboard). */
  focusComposer: number
}

function CommentsThread({ task, access, me, onClose, focusComposer }: ThreadProps) {
  const query = useTaskComments(task.id)
  const { comments, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = query
  const fileList = useCommentFileList(task.id, comments)
  const markRead = useMarkTaskRead()
  // Notify me is about other people, so only on a shared project; and Vikunja does not let API tokens
  // follow tasks (cross-app semantics 9.7): none with one.
  const { data: config } = useAppConfig()
  const canFollow = access.shared && (config?.auth_method === 'oidc' || config?.auth_method === 'password')
  const subscription = useTaskSubscription(task.id > 0 && canFollow ? task.id : null)
  const canWrite = access.permission >= 1
  const count = Math.max(task.comment_count ?? 0, comments.length)
  const fmt = useDateFormat()
  const dayKey = useDayKey()
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()

  // Opening the thread marks it read; so does a new comment arriving while it is open. Only on a
  // shared project: nobody else can write on another one (cross-app semantics 9.4).
  const readFor = useRef<number | null>(null)
  useEffect(() => {
    if (!access.shared) return
    if (readFor.current !== task.id || task.is_unread) {
      readFor.current = task.id
      markRead(task.id)
    }
  }, [access.shared, task.id, task.is_unread, markRead])

  // Read the thread again now and then while it is open.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refetch()
    }, THREAD_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refetch])

  useEffect(() => {
    if (focusComposer > 0) composerRef.current?.focus()
  }, [focusComposer])

  // Scrolling: open at the end; stay at the end when a comment arrives there and the reader was at
  // the end (or wrote it); keep the place when older comments are put above.
  const lastId = comments[comments.length - 1]?.id
  const firstId = comments[0]?.id
  const scrollState = useRef<{ lastId?: number; firstId?: number; atEnd: boolean; height: number; initial: boolean }>({ atEnd: true, height: 0, initial: true })
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const state = scrollState.current
    if (comments.length > 0 && state.initial) {
      el.scrollTop = el.scrollHeight
      state.initial = false
    } else if (firstId !== state.firstId && lastId === state.lastId && state.height > 0) {
      el.scrollTop += el.scrollHeight - state.height
    } else if (lastId !== state.lastId && (state.atEnd || (lastId !== undefined && lastId < 0))) {
      el.scrollTop = el.scrollHeight
    }
    state.firstId = firstId
    state.lastId = lastId
    state.height = el.scrollHeight
  }, [comments.length, firstId, lastId])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    scrollState.current.atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    scrollState.current.height = el.scrollHeight
    if (el.scrollTop < LOAD_OLDER_THRESHOLD_PX && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: TaskComment[] }[] = []
    const now = new Date()
    for (const comment of comments) {
      const created = new Date(comment.created)
      const key = Number.isNaN(created.getTime()) ? 'unknown' : localDayKey(created)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(comment)
      else out.push({ key, label: key === 'unknown' ? '' : formatDateDisplay('comment.day', created, now, false, fmt), items: [comment] })
    }
    return out
    // `dayKey` rolls the labels over at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, fmt, dayKey])

  return (
    <>
      <header className="shrink-0 border-b border-[var(--border-color)] px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="text-section text-text">
            Comments
          </h2>
          <span className="text-section font-medium text-text-secondary">{count}</span>
          <span className="flex-1" />
          {task.id > 0 && canFollow && (
            <Tooltip label={subscription.subscribed ? 'You get a notification for every new comment' : 'Get a notification for every new comment'}>
              <button
                type="button"
                aria-pressed={subscription.subscribed}
                disabled={!subscription.known}
                onClick={() => subscription.setSubscribed(!subscription.subscribed)}
                className={cn(
                  'inline-flex h-[26px] items-center gap-1.5 rounded-control px-2 text-meta transition-colors duration-fade-fast',
                  subscription.subscribed
                    ? 'border border-transparent bg-bg-selected text-accent-blue'
                    : 'border border-[var(--border-color)] text-text-secondary hover:bg-bg-hover hover:text-text',
                )}
              >
                {subscription.subscribed ? <Bell className="h-[13px] w-[13px]" aria-hidden="true" /> : <BellOff className="h-[13px] w-[13px]" aria-hidden="true" />}
                {subscription.subscribed ? 'Notifying you' : 'Notify me'}
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            aria-label="Close comments"
            onClick={onClose}
            className="inline-flex rounded-control p-1 text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text"
          >
            <X className="h-[15px] w-[15px]" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 truncate text-meta text-text-secondary">{task.title}</p>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 pb-2.5 pt-1.5" role="region" aria-labelledby={titleId} tabIndex={-1}>
        {access.members.length > 0 && (
          <div className="flex items-center gap-2 pb-1.5 pt-2 text-meta text-text-secondary">
            <AvatarStack people={access.members} size={16} max={4} surface="sidebar" />
            <span>{visibleToText(access.members, me?.id)}</span>
          </div>
        )}
        {isFetchingNextPage && <p className="py-2 text-center text-meta text-text-secondary">Loading older comments…</p>}
        {isLoading && comments.length === 0 ? (
          <p className="py-9 text-center text-task-title text-text-secondary">Loading comments…</p>
        ) : isError && comments.length === 0 ? (
          <div className="py-9 text-center text-task-title text-text-secondary">
            <p>Could not load the comments.</p>
            <button type="button" onClick={() => void refetch()} className={buttonClasses('quiet', false, 'mt-2')}>
              Try again
            </button>
          </div>
        ) : comments.length === 0 ? (
          <p className="py-9 text-center text-task-title text-text-secondary">No comments yet.</p>
        ) : (
          <ol aria-label="Comments" className="list-none">
            {groups.map((group) => (
              <Fragment key={group.key}>
                {group.label && (
                  <li aria-hidden="true" className="flex items-center gap-2 pb-0.5 pt-2.5 text-caption text-text-secondary">
                    {group.label}
                    <span className="vicu-hairline h-px flex-1 bg-border" />
                  </li>
                )}
                {group.items.map((comment) => (
                  <CommentItem key={comment.id} comment={comment} task={task} access={access} me={me} dayLabel={group.label} fileList={fileList} />
                ))}
              </Fragment>
            ))}
          </ol>
        )}
      </div>

      {canWrite ? (
        <Composer task={task} access={access} me={me} composerRef={composerRef} onEscape={onClose} />
      ) : (
        <p className="shrink-0 border-t border-[var(--border-color)] p-3 text-meta text-text-secondary">You can read comments in this project.</p>
      )}
    </>
  )
}

/** A run of a comment's text: mentions as "@Name" in the accent colour. */
function CommentBody({ segments }: { segments: TextSegment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        'text' in segment ? (
          <Fragment key={i}>{segment.text}</Fragment>
        ) : (
          <span key={i} className="font-semibold text-accent-blue">
            @{segment.label}
          </span>
        ),
      )}
    </>
  )
}

interface CommentItemProps {
  comment: TaskComment
  task: Task
  access: ProjectAccess
  me: PersonRef | null
  dayLabel: string
  fileList: CommentFileList
}

function CommentItem({ comment, task, access, me, dayLabel, fileList }: CommentItemProps) {
  const fmt = useDateFormat()
  const decoded = useMemo(() => decodeCommentHtml(comment.comment, access.members, task.id), [comment.comment, access.members, task.id])
  const blocks = useMemo(() => commentBlocks(decoded.segments), [decoded.segments])
  const images = useMemo(() => viewerImagesOf(decoded.attachments, fileList), [decoded.attachments, fileList])
  const [viewingId, setViewingId] = useState<number | null>(null)
  const author = comment.author
  const mine = !!author && !!me && author.id === me.id
  const name = mine ? 'You' : author ? displayName(author) : 'Someone'
  const created = new Date(comment.created)
  const time = Number.isNaN(created.getTime()) ? '' : formatDateDisplay('logbook.time', created, created, false, fmt)
  const edited = !comment.pending && isCommentEdited(comment.created, comment.updated)
  const sending = isSendingComment(comment)
  const update = useUpdateComment()
  const remove = useDeleteComment()
  const { confirmDelete, dialogProps } = useConfirmDelete()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editRef = useRef<HTMLTextAreaElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (editing) editRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(decoded.editText ?? '')
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }
  const saveEdit = () => {
    // An edit changes the text; the files stay as they are.
    const html = encodeCommentHtml(draft, access.members, decoded.attachments)
    if (!html) return
    if (html !== comment.comment) update.mutate({ task, comment, html })
    setEditing(false)
  }
  const askDelete = async () => {
    const question = decoded.attachments.length > 0
      ? "Delete comment? This cannot be undone. Its files stay in the task's attachments."
      : 'Delete comment? This cannot be undone.'
    const ok = await confirmDelete(question, { force: true })
    if (ok) remove.mutate({ task, comment })
  }
  const renderFile = (file: CommentAttachment) =>
    file.image ? (
      <CommentImage key={`${file.attachment}-${file.url}`} file={file} taskId={task.id} list={fileList} onView={() => setViewingId(file.attachment)} />
    ) : (
      <CommentFile key={`${file.attachment}-${file.url}`} file={file} taskId={task.id} list={fileList} />
    )

  // Edit only what Vicu writes itself (paragraphs, line breaks, mentions, files after the text), so nothing is lost.
  const canEdit = mine && decoded.plain && !sending
  const canDelete = mine && !sending
  const status = comment.pending ? 'Waiting to sync' : edited ? 'edited' : ''

  return (
    <li
      className="group/comment grid grid-cols-[24px_minmax(0,1fr)] gap-x-2.5 py-2"
      aria-label={`${name}, ${dayLabel ? `${dayLabel} ` : ''}${time}${status ? `, ${status}` : ''}`}
    >
      {author ? <Avatar person={author} size={24} /> : <span aria-hidden="true" className="h-6 w-6" />}
      <div className="min-w-0">
        <div className="flex min-h-5 items-baseline gap-1.5">
          <span className="text-section text-text">{name}</span>
          <span className="text-meta text-text-secondary">
            {time}
            {status && ` · ${status}`}
          </span>
          {(canEdit || canDelete) && !editing && (
            <span className="-my-0.5 ml-auto flex gap-0.5 self-center opacity-0 transition-opacity duration-fade-fast focus-within:opacity-100 group-hover/comment:opacity-100">
              {canEdit && (
                <button ref={editButtonRef} type="button" aria-label="Edit comment" onClick={startEdit} className="inline-flex rounded-control p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text">
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              {canDelete && (
                <button type="button" aria-label="Delete comment" onClick={() => void askDelete()} className="inline-flex rounded-control p-1.5 text-text-secondary hover:bg-bg-hover hover:text-danger">
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1">
            <textarea
              ref={editRef}
              value={draft}
              rows={2}
              aria-label="Edit comment"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  saveEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  cancelEdit()
                }
              }}
              className="block w-full resize-none rounded-control border border-[var(--border-color)] bg-bg-card px-2.5 py-[7px] text-task-title text-text focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
            />
            {decoded.attachments.map(renderFile)}
            <div className="mt-1.5 flex justify-end gap-1.5">
              <button type="button" onClick={cancelEdit} className={buttonClasses('secondary')}>
                Cancel
              </button>
              <button type="button" onClick={saveEdit} disabled={!draft.trim() && decoded.attachments.length === 0} className={buttonClasses('primary')}>
                Save
              </button>
            </div>
          </div>
        ) : (
          blocks.map((block, index) =>
            block.kind === 'file' ? (
              renderFile(block.file)
            ) : (
              <p key={`text-${index}`} className={cn('whitespace-pre-wrap break-words text-task-title text-text [text-wrap:pretty]', comment.pending && 'text-text-secondary')}>
                <CommentBody segments={block.segments} />
              </p>
            ),
          )
        )}
      </div>
      {viewingId !== null && <AttachmentViewer taskId={task.id} images={images} startId={viewingId} onClose={() => setViewingId(null)} />}
      <ConfirmDialog {...dialogProps} />
    </li>
  )
}

interface ComposerProps {
  task: Task
  access: ProjectAccess
  me: PersonRef | null
  composerRef: React.RefObject<HTMLTextAreaElement>
  onEscape: () => void
}

function Composer({ task, access, me, composerRef, onEscape }: ComposerProps) {
  const create = useCreateComment()
  const files = useCommentFiles(task.id)
  const { data: config } = useAppConfig()
  const [dropping, setDropping] = useState(false)
  const [text, setText] = useState(() => commentDraft(task.id))
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  // The mention the reader closed with Escape (or a press outside) stays closed until another starts.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const listId = useId()

  useEffect(() => {
    saveCommentDraft(task.id, text)
  }, [task.id, text])

  const mention: MentionQuery | null = useMemo(() => mentionQueryAt(text, caret), [text, caret])
  const suggestions = useMemo(
    () => (mention && mention.start !== dismissedAt ? mentionSuggestions(mention.query, access.members, me?.id) : []),
    [mention, dismissedAt, access.members, me?.id],
  )
  const pickerOpen = suggestions.length > 0
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1))

  useEffect(() => {
    setActive(0)
  }, [mention?.start, mention?.query])

  const syncCaret = () => setCaret(composerRef.current?.selectionStart ?? 0)

  const pick = (person: PersonRef) => {
    if (!mention) return
    const next = applyMention(text, caret, mention, person.username)
    setText(next.text)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  // A comment can be files alone; nothing is sent while a file is still on its way to the task.
  const ready = files.staged.flatMap((file) => (file.attachment ? [file.attachment] : []))
  const html = encodeCommentHtml(text, access.members, commentAttachmentsOf(ready, config?.vikunja_url ?? '', task.id))
  const canSend = !!html && !files.picking && files.staged.every((file) => file.attachment) && (ready.length === 0 || !!config?.vikunja_url)
  const send = () => {
    if (!canSend) return
    create.mutate({ task, html, me })
    files.clear()
    setText('')
    setCaret(0)
    setDismissedAt(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        setActive((activeIndex + delta + suggestions.length) % suggestions.length)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault()
        pick(suggestions[activeIndex])
        return
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      send()
      return
    }
    if (e.key === 'Escape' && !pickerOpen) {
      e.preventDefault()
      e.stopPropagation()
      onEscape()
    }
  }

  return (
    <div
      className={cn('shrink-0 border-t border-[var(--border-color)] p-3', dropping && 'bg-bg-hover')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        setDropping(false)
        files.add(filesToAttach(e.dataTransfer.files))
      }}
    >
      {files.staged.length > 0 && <StagedFiles files={files.staged} onRemove={files.remove} />}
      <textarea
        ref={composerRef}
        value={text}
        rows={3}
        placeholder={access.shared ? 'Write a comment. Type @ to mention someone.' : 'Write a comment.'}
        aria-label="Write a comment"
        aria-autocomplete="list"
        aria-controls={pickerOpen ? listId : undefined}
        aria-activedescendant={pickerOpen ? `${listId}-${activeIndex}` : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
        }}
        onSelect={syncCaret}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const pasted = pastedFiles(e)
          if (pasted.length === 0) return
          e.preventDefault()
          files.add(pasted)
        }}
        className="block w-full resize-none rounded-control border border-[var(--border-color)] bg-bg-card px-2.5 py-[7px] text-task-title text-text placeholder:text-text-secondary focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring"
      />
      {files.notice && (
        <p role="status" className="mt-1.5 text-caption text-danger">
          {files.notice}
        </p>
      )}
      {pickerOpen && (
        <Popover
          anchorRef={composerRef}
          id={listId}
          role="listbox"
          label="Mention"
          placement="top-start"
          initialFocus="none"
          onClose={() => setDismissedAt(mention?.start ?? null)}
          className="w-[328px] p-1"
        >
          {suggestions.map((person, index) => (
            <MentionOption key={person.id} id={`${listId}-${index}`} person={person} active={index === activeIndex} onPick={() => pick(person)} />
          ))}
        </Popover>
      )}
      <div className="mt-2 flex items-center">
        <AttachButton busy={files.picking} onClick={files.browse} />
        <span className="flex-1 text-caption text-text-secondary">{isMac ? '⌘' : 'Ctrl'}+Enter to send</span>
        <button type="button" onClick={send} disabled={!canSend} className={buttonClasses('primary', false, 'min-h-7 disabled:opacity-45')}>
          Comment
        </button>
      </div>
    </div>
  )
}

function MentionOption({ id, person, active, onPick }: { id: string; person: PersonRef; active: boolean; onPick: () => void }): ReactNode {
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      data-typeahead={displayName(person)}
      // Keep focus (and the caret) in the composer.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={cn('flex min-h-8 w-full items-center gap-2.5 rounded-control px-2 text-left text-task-title text-text', active ? 'bg-bg-hover' : 'hover:bg-bg-hover')}
    >
      <Avatar person={person} size={18} />
      <span className="truncate">{displayName(person)}</span>
      <span className="truncate text-text-secondary">@{person.username}</span>
    </button>
  )
}
