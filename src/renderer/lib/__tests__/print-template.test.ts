import { describe, it, expect } from 'vitest'
import { buildPrintHtml } from '../print-template'
import type { PrintablePayload } from '../print-template'
import type { Task } from '../vikunja-types'

const NULL_DATE = '0001-01-01T00:00:00Z'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Buy milk',
    description: '',
    done: false,
    done_at: NULL_DATE,
    due_date: NULL_DATE,
    start_date: NULL_DATE,
    end_date: NULL_DATE,
    priority: 0,
    project_id: 1,
    labels: null,
    reminders: null,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    created_by: { id: 1, username: 'u' },
    identifier: '#1',
    position: 0,
    bucket_id: 0,
    percent_done: 0,
    repeat_after: 0,
    repeat_mode: 0,
    hex_color: '',
    ...overrides,
  } as Task
}

const identity = (html: string) => html
const LOGO = 'data:image/png;base64,TESTLOGO'
const NOW = new Date(2026, 5, 10) // June 10, 2026 (local time)

function build(payload: PrintablePayload): string {
  return buildPrintHtml(payload, { sanitize: identity, logoDataUrl: LOGO, now: NOW })
}

describe('buildPrintHtml', () => {
  it('includes the view title, Vicu branding, and logo', () => {
    const html = build({ viewTitle: 'Today', sections: [{ groups: [{ tasks: [makeTask()] }] }] })
    expect(html).toContain('<h1>Today</h1>')
    expect(html).toContain('Vicu')
    expect(html).toContain(LOGO)
  })

  it('includes the full printed date and task count', () => {
    const html = build({
      viewTitle: 'Today',
      sections: [{ groups: [{ tasks: [makeTask({ id: 1 }), makeTask({ id: 2 })] }] }],
    })
    expect(html).toContain('Wednesday, June 10, 2026')
    expect(html).toContain('2 tasks')
  })

  it('uses singular "task" for a single task', () => {
    const html = build({ viewTitle: 'Inbox', sections: [{ groups: [{ tasks: [makeTask()] }] }] })
    expect(html).toContain('1 task')
    expect(html).not.toContain('1 tasks')
  })

  it('escapes HTML in titles and headings', () => {
    const html = build({
      viewTitle: '<script>x</script>',
      sections: [
        {
          heading: 'A & B',
          groups: [{ heading: '<b>g</b>', tasks: [makeTask({ title: '<img src=x>' })] }],
        },
      ],
    })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('&lt;b&gt;g&lt;/b&gt;')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('renders section and group headings', () => {
    const html = build({
      viewTitle: 'Today',
      sections: [{ heading: 'Overdue', groups: [{ heading: 'Work', tasks: [makeTask()] }] }],
    })
    expect(html).toContain('Overdue')
    expect(html).toContain('Work')
  })

  it('renders due and start dates, skipping null dates', () => {
    const html = build({
      viewTitle: 'T',
      sections: [
        {
          groups: [
            { tasks: [makeTask({ due_date: '2026-06-12T00:00:00Z', start_date: NULL_DATE })] },
          ],
        },
      ],
    })
    expect(html).toContain('Due Jun 12, 2026')
    expect(html).not.toContain('Starts')
  })

  it('renders priority text for prioritized tasks only', () => {
    const html = build({
      viewTitle: 'T',
      sections: [{ groups: [{ tasks: [makeTask({ id: 1, priority: 3 }), makeTask({ id: 2, priority: 0 })] }] }],
    })
    expect(html).toContain('High')
    expect(html).not.toContain('Urgent')
  })

  it('renders label pills', () => {
    const html = build({
      viewTitle: 'T',
      sections: [
        {
          groups: [
            {
              tasks: [
                makeTask({
                  labels: [
                    { id: 1, title: 'errand', hex_color: 'e8a33d', created: '', updated: '' },
                  ],
                }),
              ],
            },
          ],
        },
      ],
    })
    expect(html).toContain('errand')
    expect(html).toContain('#e8a33d')
  })

  it('passes notes through the injected sanitizer and embeds the result', () => {
    const sanitize = (h: string) => h.replace('raw', 'SANITIZED')
    const html = buildPrintHtml(
      { viewTitle: 'T', sections: [{ groups: [{ tasks: [makeTask({ description: '<p>raw note</p>' })] }] }] },
      { sanitize, logoDataUrl: LOGO, now: NOW }
    )
    expect(html).toContain('<p>SANITIZED note</p>')
  })

  it('omits the notes block when the description has no text content', () => {
    const html = build({
      viewTitle: 'T',
      sections: [{ groups: [{ tasks: [makeTask({ description: '<p></p>' })] }] }],
    })
    expect(html).not.toContain('task-notes')
  })

  it('marks done tasks (checked box, done class, completion date)', () => {
    const html = build({
      viewTitle: 'Logbook',
      sections: [
        { groups: [{ tasks: [makeTask({ done: true, done_at: '2026-06-05T10:00:00Z' })] }] },
      ],
    })
    expect(html).toContain('class="task done"')
    expect(html).toContain('Completed Jun 5, 2026')
  })

  it('renders an empty state when there are no tasks', () => {
    const html = build({ viewTitle: 'Today', sections: [] })
    expect(html).toContain('No tasks in this view')
    expect(html).toContain('0 tasks')
  })

  it('skips groups and sections that have no tasks', () => {
    const html = build({
      viewTitle: 'T',
      sections: [
        { heading: 'EmptySection', groups: [{ heading: 'EmptyGroup', tasks: [] }] },
        { heading: 'Full', groups: [{ tasks: [makeTask()] }] },
      ],
    })
    expect(html).not.toContain('EmptySection')
    expect(html).not.toContain('EmptyGroup')
    expect(html).toContain('Full')
  })
})
