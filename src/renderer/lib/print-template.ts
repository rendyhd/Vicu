import type { Task } from './vikunja-types'
import { isNullDate } from './date-utils'
import { normalizeHex } from './constants'

export interface PrintGroup {
  heading?: string
  tasks: Task[]
}

export interface PrintSection {
  heading?: string
  groups: PrintGroup[]
}

export interface PrintablePayload {
  viewTitle: string
  sections: PrintSection[]
}

export interface PrintOptions {
  // Injected (instead of importing sanitizeTaskHtml / the logo asset) so this
  // module stays a pure function testable in vitest's node environment.
  sanitize: (html: string) => string
  logoDataUrl: string
  now?: Date
}

const PRIORITY_LABELS = ['', 'Low', 'Medium', 'High', 'Urgent']

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatPrintDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

function renderLabels(task: Task): string {
  const labels = task.labels ?? []
  if (labels.length === 0) return ''
  const pills = labels
    .map((l) => {
      const hex = normalizeHex(l.hex_color) ?? '#999999'
      return `<span class="label"><span class="label-dot" style="background:${hex}"></span>${escapeHtml(l.title)}</span>`
    })
    .join('')
  return `<span class="labels">${pills}</span>`
}

function renderTask(task: Task, sanitize: (html: string) => string): string {
  const meta: string[] = []
  if (task.priority > 0 && PRIORITY_LABELS[task.priority]) {
    meta.push(`<span class="meta-priority">⚑ ${PRIORITY_LABELS[task.priority]}</span>`)
  }
  if (!isNullDate(task.due_date)) meta.push(`Due ${formatPrintDate(task.due_date)}`)
  if (!isNullDate(task.start_date)) meta.push(`Starts ${formatPrintDate(task.start_date)}`)
  if (task.done && !isNullDate(task.done_at)) meta.push(`Completed ${formatPrintDate(task.done_at)}`)

  const notes = sanitize(task.description ?? '')
  return `
    <div class="task${task.done ? ' done' : ''}">
      <span class="checkbox">${task.done ? '✓' : ''}</span>
      <div class="task-body">
        <div class="task-line">
          <span class="task-title">${escapeHtml(task.title)}</span>
          ${renderLabels(task)}
        </div>
        ${meta.length > 0 ? `<div class="task-meta">${meta.join('<span class="sep">·</span>')}</div>` : ''}
        ${hasText(notes) ? `<div class="task-notes">${notes}</div>` : ''}
      </div>
    </div>`
}

export function buildPrintHtml(payload: PrintablePayload, options: PrintOptions): string {
  const now = options.now ?? new Date()
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const allTasks = payload.sections.flatMap((s) => s.groups.flatMap((g) => g.tasks))
  const countLine = `${allTasks.length} ${allTasks.length === 1 ? 'task' : 'tasks'}`

  const body =
    allTasks.length === 0
      ? '<p class="empty">No tasks in this view.</p>'
      : payload.sections
          .map((section) => {
            const groups = section.groups
              .filter((g) => g.tasks.length > 0)
              .map(
                (g) =>
                  `${g.heading ? `<h3 class="group-heading">${escapeHtml(g.heading)}</h3>` : ''}${g.tasks
                    .map((t) => renderTask(t, options.sanitize))
                    .join('')}`
              )
              .join('')
            if (!groups) return ''
            return `<section>${
              section.heading ? `<h2 class="section-heading">${escapeHtml(section.heading)}</h2>` : ''
            }${groups}</section>`
          })
          .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(payload.viewTitle)} — Vicu</title>
<style>
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, 'Segoe UI', system-ui, Roboto, sans-serif;
    color: #1a1a1a;
    font-size: 13px;
    line-height: 1.45;
  }
  .brand { display: flex; align-items: center; gap: 6px; margin-bottom: 14px; }
  .brand img { width: 18px; height: 18px; border-radius: 4px; }
  .brand span { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: #555; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 0 0 2px; }
  .date-line { font-size: 12px; color: #666; margin: 0 0 16px; }
  .date-line .count { color: #999; }
  hr.rule { border: none; border-top: 1px solid #ddd; margin: 0 0 6px; }
  .section-heading {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    color: #444; margin: 18px 0 4px; break-after: avoid;
  }
  .group-heading {
    font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
    color: #888; margin: 10px 0 2px; break-after: avoid;
  }
  .task {
    display: flex; gap: 8px; padding: 5px 0;
    border-bottom: 1px solid #eee;
    break-inside: avoid;
  }
  .checkbox {
    flex-shrink: 0; width: 13px; height: 13px; margin-top: 2px;
    border: 1.5px solid #555; border-radius: 3px;
    font-size: 10px; line-height: 11px; text-align: center; color: #555;
  }
  .task-body { min-width: 0; flex: 1; }
  .task-line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .task-title { font-weight: 500; }
  .done .task-title { text-decoration: line-through; color: #888; }
  .labels { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .label {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; color: #555; border: 1px solid #ccc; border-radius: 9px;
    padding: 0 7px; line-height: 16px;
  }
  .label-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .task-meta { font-size: 11px; color: #777; margin-top: 1px; }
  .task-meta .sep { margin: 0 5px; color: #bbb; }
  .meta-priority { font-weight: 600; color: #444; }
  .task-notes { font-size: 11.5px; color: #444; margin-top: 3px; }
  .task-notes p { margin: 0 0 4px; }
  .task-notes ul, .task-notes ol { margin: 2px 0 4px; padding-left: 18px; }
  .task-notes a { color: #444; }
  .task-notes pre, .task-notes code { font-family: Consolas, monospace; font-size: 10.5px; }
  .task-notes blockquote { margin: 2px 0; padding-left: 8px; border-left: 2px solid #ccc; color: #666; }
  .empty { color: #777; font-size: 13px; }
  footer {
    margin-top: 28px; padding-top: 8px; border-top: 1px solid #ddd;
    font-size: 10px; color: #999;
  }
</style>
</head>
<body>
  <div class="brand"><img src="${options.logoDataUrl}" alt=""><span>Vicu</span></div>
  <h1>${escapeHtml(payload.viewTitle)}</h1>
  <p class="date-line">${dateLine} <span class="count">· ${countLine}</span></p>
  <hr class="rule">
  ${body}
  <footer>Printed from Vicu · ${dateLine}</footer>
</body>
</html>`
}
