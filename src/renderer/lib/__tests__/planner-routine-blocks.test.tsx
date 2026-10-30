import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DayViewCalendar } from '@/components/planner/DayViewCalendar'
import type { PlannerCalendarEvent } from '../planner-calendar'
import type { Task } from '../vikunja-types'

const state = vi.hoisted(() => ({
  preview: null as { taskId: number; changes: Partial<Task> } | null,
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
function event(status: 'PENDING' | 'COMPLETED' | 'SKIPPED' = 'PENDING'): PlannerCalendarEvent {
  const task = { id: 100, title: 'Hidden carrier', done: true, description: '' } as Task
  return {
    task, start: new Date(2026, 5, 10, 9), end: new Date(2026, 5, 10, 9, 45),
    startMinute: 540, endMinute: 585, column: 0, columnCount: 1,
    routine: {
      carrier: { task, payload: { definition: { name: 'Morning walk' } } } as NonNullable<PlannerCalendarEvent['routine']>['carrier'],
      key: 'r1:2026-06-10:s1', slot: { id: 's1', label: '', period: 'MORNING', reminderMinutes: 540, reminderEnabled: false, followUpMinutes: 0 },
      scheduledDate: '2026-06-10', status, loggedAt: '', note: '',
    },
  }
}
const render = (routine: PlannerCalendarEvent) => renderToStaticMarkup(
  <DayViewCalendar day={day} events={{ timed: [routine] }} isLoading={false} />,
)

afterEach(() => {
  state.preview = null
  state.drops = []
})

describe('routine calendar blocks', () => {
  it('uses the routine name and status, without task identifiers or edit controls', () => {
    const html = render(event())
    expect(html).toContain('data-calendar-routine="r1:2026-06-10:s1"')
    expect(html).toContain('Morning walk')
    expect(html).not.toContain('Hidden carrier')
    expect(html).not.toContain('data-calendar-task=')
    expect(html).not.toContain('data-calendar-edit=')
    expect(html).not.toContain(', completed')
    expect(html).not.toContain('line-through')
  })

  it('shows completed and skipped occurrence states rather than the always-done carrier', () => {
    expect(render(event('COMPLETED'))).toContain(', routine, completed')
    expect(render(event('COMPLETED'))).toContain('line-through')
    expect(render(event('SKIPPED'))).toContain(', routine, skipped')
  })

  it('retains routines and shares overlap columns during task drop previews', () => {
    state.drops = [{ id: 1, project_id: 1, title: 'Dropped task', start_date: new Date(2026, 5, 10, 9).toISOString(), description: '', done: false } as Task]
    const html = render(event())
    expect(html).toContain('data-calendar-routine="r1:2026-06-10:s1"')
    expect(html).toContain('data-calendar-drop-preview="1"')
    expect(html.match(/width:50%/g)).toHaveLength(2)
  })

  it('does not treat a carrier as a task during edit previews', () => {
    state.preview = { taskId: 1, changes: {} }
    const html = render(event())
    expect(html).toContain('data-calendar-routine="r1:2026-06-10:s1"')
    expect(html).not.toContain('data-calendar-task=')
    expect(html).not.toContain('data-calendar-edit=')
  })
})
