import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { usePersonLabels } from '@/hooks/use-people'
import { newLedgerId, setRecord, writeLedger } from '@/hooks/use-pro-ledger'
import type { MeetingValue } from '../../../shared/pro/ledger'

const RHYTHMS = ['', 'weekly', 'every two weeks', 'monthly']

/**
 * A meeting (cross-app semantics 21.9, plan 7.5.1): a name, its people in the order the round goes,
 * and how often it meets. Kept in the ledger, so every device knows it.
 */
export function MeetingDialog({ meeting, id, onClose }: { meeting?: MeetingValue | null; id?: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const people = usePersonLabels()
  const [name, setName] = useState(meeting?.name ?? '')
  const [order, setOrder] = useState<number[]>(meeting?.people ?? [])
  const [rhythm, setRhythm] = useState(meeting?.rhythm ?? '')
  const others = [...people.values()].filter((label) => !order.includes(label.id))

  const move = (index: number, by: number) => {
    const next = [...order]
    const [entry] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, entry)
    setOrder(next)
  }
  const save = () => {
    const value: MeetingValue = { ...(meeting ?? {}), name: name.trim(), people: order, rhythm: rhythm || null }
    void writeLedger(queryClient, [setRecord('meetings', id ?? newLedgerId(), value)])
    onClose()
  }

  return (
    <Dialog open label="Meeting" onClose={onClose} className="w-[440px] max-w-[92vw] p-5">
      <h2 className="mb-3 text-card-title text-text">{meeting ? 'Edit meeting' : 'New meeting'}</h2>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Name" autoFocus className="mb-3 w-full rounded-control border border-border bg-bg-page px-2 py-1.5 text-task-title text-text" />
      <p className="mb-1 text-group text-text-secondary">People, in round order</p>
      <ul className="mb-2 space-y-1">
        {order.map((personId, index) => (
          <li key={personId} className="flex items-center gap-2 rounded-control border border-border px-2 py-1 text-meta text-text">
            <span className="min-w-0 flex-1 truncate">{people.get(personId)?.title ?? 'Someone'}</span>
            <button type="button" aria-label="Earlier" disabled={index === 0} onClick={() => move(index, -1)} className="rounded-control p-0.5 hover:bg-bg-hover disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
            <button type="button" aria-label="Later" disabled={index === order.length - 1} onClick={() => move(index, 1)} className="rounded-control p-0.5 hover:bg-bg-hover disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
            <button type="button" aria-label="Remove" onClick={() => setOrder(order.filter((entry) => entry !== personId))} className="rounded-control p-0.5 hover:bg-bg-hover"><X className="h-3 w-3" /></button>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <select value="" onChange={(event) => event.target.value && setOrder([...order, Number(event.target.value)])} aria-label="Add a person" className="mb-3 w-full rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text">
          <option value="">Add a person</option>
          {others.map((label) => <option key={label.id} value={label.id}>{label.title}</option>)}
        </select>
      )}
      <label className="flex items-center gap-2 text-meta text-text">
        Meets
        <select value={rhythm ?? ''} onChange={(event) => setRhythm(event.target.value)} className="rounded-control border border-border bg-bg-page px-2 py-1">
          {RHYTHMS.map((value) => <option key={value} value={value}>{value || 'when it meets'}</option>)}
        </select>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>Cancel</button>
        <button type="button" disabled={!name.trim() || order.length === 0} className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent disabled:opacity-40" onClick={save}>Save</button>
      </div>
    </Dialog>
  )
}
