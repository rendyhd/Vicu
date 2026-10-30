import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DayViewCalendar } from '@/components/planner/DayViewCalendar'
import { calDavCalendarBlocks, layoutCalendarOverlaps, type CalendarBlock } from '../planner-calendar'
import { calendarEditRange } from '../planner-calendar-edit'
import type { CalDavEvent, CalDavEventUpdate } from '../../../shared/caldav-types'
import type { Task } from '../vikunja-types'

const state = vi.hoisted(() => ({
  preview: null as { changes: Partial<Task>; caldav?: CalDavEventUpdate } | null,
  drops: [] as Task[],
}))
vi.mock('@/hooks/use-date-format', () => ({ useDateFormat: () => ({ locale: 'en-GB', hourCycle: 'h23' }) }))
vi.mock('@/hooks/use-calendar-edit', () => ({
  useCalendarEdit: () => ({ preview: state.preview, isPending: false, onPointerDown: vi.fn(), onKeyDown: vi.fn() }),
}))
vi.mock('@/hooks/use-calendar-drop', () => ({
  useCalendarDrop: () => ({ tasks: state.drops, setNodeRef: vi.fn(), onScroll: vi.fn() }),
}))

const day = new Date(2026, 5, 10)
const date = (hour: number, minute = 0) => new Date(2026, 5, 10, hour, minute).toISOString()
const event = (fields: Partial<CalDavEvent> = {}): CalDavEvent => ({
  id: 'external', occurrenceKey: fields.id ?? 'external', connectionId: 'connection', calendarUrl: 'https://example.com/work/', calendarName: 'Work',
  color: '#cc5599', title: 'External meeting', start: date(9), end: date(10), allDay: false, readOnly: false, ...fields,
})
const render = (events: CalDavEvent[]) => renderToStaticMarkup(
  <DayViewCalendar day={day} events={{ timed: [] }} caldavEvents={events} isLoading={false} />,
)
afterEach(() => { state.preview = null; state.drops = [] })

describe('Planner CalDAV calendar blocks', () => {
  it('shows calendar color and name, exposes drag/resize controls, never a task id', () => {
    const html = render([event()])
    expect(html).toContain('data-calendar-caldav="external"')
    expect(html).toContain('External meeting')
    expect(html).toContain('Work')
    expect(html).toContain('border-color:#cc5599')
    expect(html).toContain('data-calendar-edit="move"')
    expect(html).toContain('data-calendar-edit="start"')
    expect(html).toContain('data-calendar-edit="end"')
    expect(html).not.toContain('data-calendar-task=')
  })

  it('keeps read-only events visible without edit handles', () => {
    const html = render([event({ readOnly: true })])
    expect(html).toContain('read-only')
    expect(html).not.toContain('data-calendar-edit=')
  })

  it('shows all-day events in a separate strip instead of occupying the whole grid', () => {
    const html = render([event({ allDay: true })])
    expect(html).toContain('All-day calendar events')
    expect(html).toContain('External meeting')
    expect(html).not.toContain('data-calendar-caldav=')
    expect(html).not.toContain('data-calendar-edit=')
  })

  it('shares overlap columns with task drop previews', () => {
    state.drops = [{ id: 1, project_id: 1, title: 'Task', start_date: date(9), description: '', done: false } as Task]
    const html = render([event()])
    expect(html.match(/width:50%/g)).toHaveLength(2)
    expect(html).toContain('data-calendar-drop-preview="1"')
  })

  it('previews CalDAV moves independently of tasks and other calendars', () => {
    state.preview = { changes: {}, caldav: { id: 'external', start: date(11), end: date(12) } }
    const html = render([event(), event({ id: 'other', title: 'Other event', color: '#336699' })])
    expect(html).toContain('11:00 – 12:00')
    expect(html).toContain('09:00 – 10:00')
    expect(html).toContain('border-color:#cc5599')
    expect(html).toContain('border-color:#336699')
  })

  it('clips overnight bounds and does not expose resize handles for hidden edges', () => {
    const overnight = event({ start: new Date(2026, 5, 9, 23).toISOString(), end: date(1) })
    const [block] = calDavCalendarBlocks([overnight], day)
    expect(block.startMinute).toBe(0)
    expect(block.endMinute).toBe(60)
    const html = render([overnight])
    expect(html).not.toContain('data-calendar-edit="start"')
    expect(html).toContain('data-calendar-edit="end"')
  })

  it('assigns independent overlap columns even when calendars share event titles', () => {
    const blocks = calDavCalendarBlocks([event(), event({ id: 'other' })], day)
    const layout = layoutCalendarOverlaps<CalendarBlock>(blocks)
    expect(layout.map((item) => item.column).sort()).toEqual([0, 1])
    expect(layout.every((item) => item.columnCount === 2)).toBe(true)
  })

  it('moves both endpoints but resizes only one, enforcing a positive duration', () => {
    const [block] = calDavCalendarBlocks([event()], day)
    expect(calendarEditRange(block, 'move', 15)).toEqual({ start: date(9, 15), end: date(10, 15) })
    expect(calendarEditRange(block, 'end', 15)).toEqual({ start: date(9), end: date(10, 15) })
    expect(calendarEditRange(block, 'start', -15)).toEqual({ start: date(8, 45), end: date(10) })
    const inverted = calendarEditRange(block, 'end', -120)
    expect(+new Date(inverted.end) - +new Date(inverted.start)).toBe(60_000)
  })
})
