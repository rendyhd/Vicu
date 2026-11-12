import type { Task } from '@/lib/vikunja-types'
import type { PromiseWorld } from '@/hooks/use-promise-world'
import type { LocalDate } from '../../../shared/due-dates'
import { effectiveDue, missesOf } from '../../../shared/pro/promises'
import type { OwedValue } from '../../../shared/pro/ledger'

export const UNCLEAR_ITEM = "What's still unclear?"

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A 1:1 agenda for one person (plan 7.3.6): the pinned "What's still unclear?", their promises that
 * are due or missed, what you owe them, and decisions they owe. Plain text and HTML for the
 * clipboard.
 */
export function personAgenda(name: string, theirs: readonly Task[], mine: readonly Task[], world: PromiseWorld, today: LocalDate) {
  const items: string[] = [UNCLEAR_ITEM]
  const byDue = (a: Task, b: Task) => {
    const da = effectiveDue(a, world.promiseFor(a)) ?? '9999'
    const db = effectiveDue(b, world.promiseFor(b)) ?? '9999'
    return da < db ? -1 : da > db ? 1 : a.id - b.id
  }
  for (const task of [...theirs].sort(byDue)) {
    const promise = world.promiseFor(task)
    const due = effectiveDue(task, promise)
    const misses = missesOf(promise)
    const note = due && due < today ? ' (overdue)' : due === today ? ' (due today)' : ''
    items.push(`${task.title.trim()}${note}${misses > 0 ? `, ${misses === 1 ? 'missed once' : `missed ${misses} times`}` : ''}`)
  }
  for (const task of [...mine].sort(byDue)) items.push(`Mine: ${task.title.trim()}`)
  const personId = theirs[0] ? world.promiseFor(theirs[0])?.person : mine[0] ? world.promiseFor(mine[0])?.person : null
  for (const record of Object.values(world.ledger.owed)) {
    const owed = record.value as OwedValue | null
    if (owed && !owed.resolved && personId != null && owed.from === personId) items.push(`Decision needed: ${owed.what}`)
  }
  const title = `1:1 with ${name}`
  const text = [title, '', ...items.map((item) => `- ${item}`)].join('\n')
  const html = `<p><strong>${escapeHtml(title)}</strong></p><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
  return { items, text, html }
}
