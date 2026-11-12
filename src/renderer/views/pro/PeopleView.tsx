import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useLabels } from '@/hooks/use-labels'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { PersonMark } from '@/components/pro/PersonMark'
import { ProOffNotice } from '@/components/pro/ProOffNotice'
import { toLocalDate } from '../../../shared/due-dates'
import { effectiveDue } from '../../../shared/pro/promises'
import { finalVerdictOf } from '../../../shared/pro/ledger'

/** People (cross-app semantics 21.5): who you work with, what is open both ways, the next due first. */
export function PeopleView() {
  const world = usePromiseWorld()
  const navigate = useNavigate()
  const { data: labels = [] } = useLabels()
  const prefs = useProPrefs()
  const [adding, setAdding] = useState('')
  const today = toLocalDate(new Date())

  const rows = useMemo(() => {
    const byPerson = new Map<number, { theirs: number; mine: number; next: string | null; overdue: number }>()
    for (const id of world.people.keys()) byPerson.set(id, { theirs: 0, mine: 0, next: null, overdue: 0 })
    for (const task of world.open) {
      const promise = world.promiseFor(task)
      if (!promise || promise.person === null || finalVerdictOf(promise)) continue
      const entry = byPerson.get(promise.person)
      if (!entry) continue
      if (promise.dir === 'theirs') entry.theirs++
      else if (promise.dir === 'mine') entry.mine++
      const due = effectiveDue(task, promise)
      if (due && (entry.next === null || due < entry.next)) entry.next = due
      if (due && due < today) entry.overdue++
    }
    return [...byPerson.entries()]
      .map(([id, counts]) => ({ id, name: world.nameOf(id), color: world.people.get(id)?.hex_color, ...counts }))
      .sort((a, b) => (a.next === b.next ? a.name.localeCompare(b.name) : a.next === null ? 1 : b.next === null ? -1 : a.next < b.next ? -1 : 1))
  }, [world, today])

  if (!world.on) return <ProOffNotice title="People" />
  const candidates = labels.filter((label) => !prefs.isPerson(label.id))

  return (
    <ReadingScroll className="bg-[var(--bg-primary)]" columnClassName="flex flex-col">
      <PageHeader title="People" inScroll />
      <div className="mx-6 max-w-[720px] pb-8">
        {rows.length === 0 && (
          <p className="py-6 text-sm text-text-secondary">
            No people yet. A person is a label: mark one below, or right-click a label in the sidebar and choose This is a person.
          </p>
        )}
        <ul className="divide-y divide-border" data-pro-people>
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-bg-hover"
                onClick={() => navigate({ to: '/person/$labelId', params: { labelId: String(row.id) } })}
              >
                <PersonMark name={row.name} color={row.color} />
                <span className="min-w-0 flex-1 truncate text-task-title text-text">{row.name}</span>
                <span className="text-meta text-text-secondary">{row.theirs} from them</span>
                <span className="text-meta text-text-secondary">{row.mine} from you</span>
                {row.overdue > 0 && <span className="text-meta text-status-overdue">{row.overdue} overdue</span>}
              </button>
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <div className="mt-6 flex items-center gap-2">
            <select value={adding} onChange={(event) => setAdding(event.target.value)} aria-label="Label" className="rounded-control border border-border bg-bg-page px-3 py-1.5 text-sm text-text">
              <option value="">Choose a label</option>
              {candidates.map((label) => <option key={label.id} value={label.id}>{label.title}</option>)}
            </select>
            <button
              type="button"
              disabled={!adding}
              className="rounded-control border border-border px-3 py-1.5 text-sm text-text hover:bg-bg-hover disabled:opacity-40"
              onClick={() => {
                void prefs.setPerson(Number(adding), true)
                setAdding('')
              }}
            >
              Add as a person
            </button>
          </div>
        )}
      </div>
    </ReadingScroll>
  )
}
