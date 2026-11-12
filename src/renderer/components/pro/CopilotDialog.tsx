import { useMemo, useState } from 'react'
import { Dialog } from '@/components/overlay/Dialog'
import { Checkbox } from '@/components/shared/Checkbox'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useProjects } from '@/hooks/use-projects'
import { useCollabMe } from '@/hooks/use-project-access'
import { useProUiStore } from '@/stores/pro-ui-store'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import { openPromises } from '@/lib/pro/export'
import { toLocalDate } from '../../../shared/due-dates'
import { copilotPrompt } from '../../../shared/pro/import'
import { recordValue } from '../../../shared/pro/ledger'
import { PRO_AI } from '../../../shared/ai/contract'

/**
 * Ask Copilot (decision 33, plan 7.4.1): a prompt to paste into Copilot (or any assistant) next to a
 * meeting, mail thread or chat; its answer is pasted back into Import. Nothing is sent anywhere.
 */
export function CopilotDialog({ onClose, personId }: { onClose: () => void; personId?: number }) {
  const world = usePromiseWorld()
  const { data: projects } = useProjects()
  const me = useCollabMe()
  const openImport = useProUiStore((s) => s.open)
  const [kind, setKind] = useState<string>('meeting')
  const [date, setDate] = useState(toLocalDate(new Date()))
  const [includeOpen, setIncludeOpen] = useState(true)

  const prompt = useMemo(() => {
    const projectTitle = (id: number) => projects?.all.find((project) => project.id === id)?.title ?? null
    const people = personId !== undefined ? [world.nameOf(personId)] : [...world.people.values()].map((label) => label.title)
    const initiatives = Object.keys(world.ledger.initiatives)
      .filter((id) => {
        const value = recordValue(world.ledger.initiatives, id)
        return value && value.status !== 'closed'
      })
      .flatMap((id) => projectTitle(Number(id)) ?? [])
    const open = includeOpen ? openPromises(world, projectTitle, (_task, person) => personId === undefined || person === personId) : []
    return copilotPrompt(PRO_AI.copilotPrompt, { kind, date, me: me?.name || me?.username || 'me', people, initiatives, open })
  }, [world, projects?.all, personId, kind, date, includeOpen, me])

  const copy = async () => {
    await api.writeClipboardRich(prompt)
    toast.success('Prompt copied. Paste the answer into Import.', {
      action: { label: 'Import', onAction: () => openImport('pro-import', personId !== undefined ? { personId } : null) },
    })
    onClose()
  }

  return (
    <Dialog open label="Ask Copilot" onClose={onClose} className="w-[640px] max-w-[92vw] p-5">
      <h2 className="mb-1 text-card-title text-text">Ask Copilot</h2>
      <p className="mb-3 text-meta text-text-secondary">Copy this prompt into Copilot next to the meeting, mail or chat. Paste its answer into Import.</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-meta text-text">
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="From" className="rounded-control border border-border bg-bg-page px-2 py-1">
          {Object.entries(PRO_AI.copilotPrompt.kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} aria-label="Date" className="rounded-control border border-border bg-bg-page px-2 py-1" />
        <label className="flex cursor-pointer items-center gap-1.5"><Checkbox checked={includeOpen} onChange={(event) => setIncludeOpen(event.target.checked)} /> Open promises</label>
      </div>
      <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-card border border-border bg-bg-hover p-3 font-sans text-meta text-text" data-pro-copilot-prompt>{prompt}</pre>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="rounded-control px-3 py-1.5 text-meta text-text hover:bg-bg-hover" onClick={onClose}>Cancel</button>
        <button type="button" className="rounded-control bg-accent-fill px-3 py-1.5 text-meta font-medium text-on-accent" onClick={() => void copy()}>Copy prompt</button>
      </div>
    </Dialog>
  )
}
