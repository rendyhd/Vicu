import { useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarX2, ChevronDown, FolderOpen, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { NULL_DATE } from '@/lib/constants'
import { formatDateChip } from '@/lib/date-utils'
import { dateOnlyDue, isDateOnly, localDateOf, toLocalDate } from '@/lib/due-dates'
import { quickChoices } from '@/lib/when-logic'
import { useDateFormat } from '@/hooks/use-date-format'
import { useDayKey } from '@/stores/day-store'
import { Button } from '@/components/shared/Button'
import { WhenPopover } from '@/components/task-list/WhenPopover'
import { ProjectPickerPopover } from '@/components/task-list/ProjectPickerPopover'
import { useWeekStart } from '@/hooks/use-week-start'

// The pieces every guided session draws (docs/cross-app-semantics-v1.md section 14; the focus
// stepper of design_handoff_review_flow, Direction C): a header with how far along the person is,
// one card in the middle, the keys along the bottom. Suggested choices have the dashed outline of
// smart dictation's guessed fields (docs/ai-assistant-v1.md 4.5, 9.4).

export const SUGGESTED = 'border-dashed border-accent-blue'

interface FrameProps {
  title: string
  icon: React.ReactNode
  /** "4 of 14": the card on screen and the queue's length; null on the summary. */
  position: { current: number; total: number } | null
  /** A line under the header: suggestions on their way, or why there are none. */
  status?: React.ReactNode
  exitLabel?: string
  onExit: () => void
  hints?: ReadonlyArray<readonly [string, string]>
  children: React.ReactNode
}

export function GuidedFrame({ title, icon, position, status, exitLabel = 'Exit', onExit, hints, children }: FrameProps) {
  const progress = position && position.total > 0 ? Math.min(1, (position.current - 1) / position.total) : 1
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-secondary)]">
      <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-primary)] px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 items-center">{icon}</span>
          <h1 className="min-w-0 truncate text-section text-[var(--text-primary)]">{title}</h1>
          <span className="flex-1" />
          {position && (
            <span className="text-meta tabular-nums text-[var(--text-secondary)]" aria-live="polite">
              {Math.min(position.current, position.total)} of {position.total}
            </span>
          )}
          <Button variant="secondary" onClick={onExit}>{exitLabel}</Button>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--bg-hover)]" aria-hidden="true">
          <div className="h-full bg-accent-purple transition-[width] duration-fade-base ease-standard" style={{ width: `${progress * 100}%` }} />
        </div>
        {status && <div className="mt-2 text-caption text-[var(--text-secondary)]">{status}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-[640px]">{children}</div>
      </div>
      {hints && hints.length > 0 && (
        <div className="shrink-0 border-t border-[var(--border-color)] bg-[var(--bg-primary)] px-6 py-2.5">
          <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-caption text-[var(--text-secondary)]" aria-label="Keyboard shortcuts">
            {hints.map(([keys, label]) => (
              <li key={label} className="flex items-center gap-1.5">
                {keys.split(' ').map((key) => <kbd key={key} className="rounded-chip border border-[var(--border-color)] bg-[var(--bg-hover)] px-1.5 font-mono text-caption">{key}</kbd>)}
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The white card in the middle (Direction C's focus card). */
export function GuidedCardShell({ children, footer, className }: { children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg', className)}>
      <div className="px-7 pb-5 pt-6">{children}</div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-color)] bg-sidebar px-4 py-3">{footer}</div>}
    </section>
  )
}

/** A field's name above its choices. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{children}</div>
}

/** The model's reason under the title, or that it is on its way. */
export function SuggestionLine({ reason, pending }: { reason?: string | null; pending?: boolean }) {
  if (reason) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-meta text-[var(--text-secondary)]">
        <Sparkles aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-blue" />
        <span><span className="sr-only">Suggestion: </span>{reason}</span>
      </p>
    )
  }
  if (pending) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-meta text-[var(--text-secondary)]" role="status">
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> A suggestion is on its way
      </p>
    )
  }
  return null
}

interface WhenChoicesProps {
  /** The due date chosen: an ISO date or the null date. */
  value: string
  onChange: (due: string) => void
  suggested?: boolean
  /** Opens the date picker from the keyboard (`d`). */
  pickerOpen?: boolean
  onPickerOpenChange?: (open: boolean) => void
  /** Smaller buttons, for a row of the review page. */
  compact?: boolean
  label?: string
}

/**
 * The When panel's quick choices (Today, Tomorrow, This weekend, Next week), a date picked in the
 * When panel, and No date when there is one (section 14.3). The one chosen is pressed.
 */
export function WhenChoices({ value, onChange, suggested, pickerOpen, onPickerOpenChange, compact, label = 'When' }: WhenChoicesProps) {
  const fmt = useDateFormat()
  const dayKey = useDayKey()
  const today = useMemo(() => toLocalDate(new Date()), [dayKey])
  const pickRef = useRef<HTMLButtonElement>(null)
  const [ownOpen, setOwnOpen] = useState(false)
  const open = pickerOpen ?? ownOpen
  const setOpen = onPickerOpenChange ?? setOwnOpen
  const day = localDateOf(value)
  const choices = quickChoices(today, fmt, useWeekStart())
  const quick = choices.find((choice) => choice.date === day)
  const hasDate = day !== ''
  const size = compact ? 'min-h-7 px-2.5 text-meta' : ''
  const pressed = (on: boolean) => cn(size, on && 'border-accent-blue bg-accent-blue/12 text-[var(--text-primary)]', on && suggested && SUGGESTED)

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {choices.map((choice, i) => (
        <Button
          key={choice.id}
          aria-pressed={quick?.id === choice.id}
          aria-keyshortcuts={compact ? undefined : String(i + 1)}
          onClick={() => onChange(dateOnlyDue(choice.date))}
          className={pressed(quick?.id === choice.id)}
        >
          {choice.label}
          <span className="text-caption text-[var(--text-secondary)]">{choice.hint}</span>
        </Button>
      ))}
      <Button
        ref={pickRef}
        aria-pressed={hasDate && !quick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={compact ? undefined : 'D'}
        onClick={() => setOpen(!open)}
        className={pressed(hasDate && !quick)}
      >
        <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
        {hasDate && !quick ? formatDateChip(new Date(value), isDateOnly(value), new Date(), fmt) : 'Pick a date'}
      </Button>
      {hasDate && (
        <Button aria-keyshortcuts={compact ? undefined : '0'} onClick={() => onChange(NULL_DATE)} className={size}>
          <CalendarX2 aria-hidden="true" className="h-3.5 w-3.5" /> No date
        </Button>
      )}
      {!hasDate && suggested && (
        <span className={cn('inline-flex min-h-7 items-center gap-1 rounded-control border px-2.5 text-meta text-[var(--text-secondary)]', SUGGESTED)}>
          <CalendarX2 aria-hidden="true" className="h-3.5 w-3.5" /> No date
        </span>
      )}
      {open && (
        <WhenPopover
          anchorRef={pickRef}
          currentDate={value}
          onDateChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

interface ProjectChoiceProps {
  projectId: number
  path: string
  onChange: (projectId: number) => void
  suggested?: boolean
  pickerOpen?: boolean
  onPickerOpenChange?: (open: boolean) => void
  compact?: boolean
}

/** The project the task goes to, picked from the project picker. */
export function ProjectChoice({ projectId, path, onChange, suggested, pickerOpen, onPickerOpenChange, compact }: ProjectChoiceProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [ownOpen, setOwnOpen] = useState(false)
  const open = pickerOpen ?? ownOpen
  const setOpen = onPickerOpenChange ?? setOwnOpen
  return (
    <>
      <Button
        ref={ref}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-keyshortcuts={compact ? undefined : 'P'}
        aria-label={`Project: ${path}`}
        onClick={() => setOpen(!open)}
        className={cn('max-w-full', compact && 'min-h-7 px-2.5 text-meta', suggested && SUGGESTED)}
      >
        <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{path}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </Button>
      {open && <ProjectPickerPopover anchorRef={ref} currentProjectId={projectId} onSelect={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Whether a key press belongs to a text field, a popover or a dialog rather than the session. */
export function isSessionKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.defaultPrevented) return false
  const target = event.target
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return false
    if (target.closest('[popover], dialog, [role="dialog"], [role="menu"], [role="listbox"]')) return false
  }
  return document.querySelector('dialog[open]') === null
}
