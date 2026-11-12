import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { readSaid } from '@/lib/ai/said-parser'
import { checkPromiseDrafts, promiseDraftsUser, type PromiseDraft } from '../../../shared/ai/pro-import'
import { localDateTimeOf } from '../../../shared/ai/dictation'

const SMALL = 'rounded-control border border-border px-2 py-0.5 text-meta text-text hover:bg-bg-hover disabled:opacity-40'

/**
 * Promise drafts on a meeting card (docs/ai-assistant-v1.md section 11.2): what was said (typed, or
 * the system's dictation) goes to the assistant, and the drafts it finds are checked and shown;
 * each is added only on a tap. Rendered only while Pro's assistant is on and Ask is ready.
 */
export function PromiseDrafts({ person, me, mine, onAdd }: {
  person: string
  me: string
  /** Your open promises to this person: title and task id. */
  mine: ReadonlyArray<{ id: number; title: string }>
  onAdd: (draft: PromiseDraft, needs: number[]) => Promise<void>
}) {
  const [transcript, setTranscript] = useState('')
  const [drafts, setDrafts] = useState<Array<PromiseDraft & { added?: boolean }>>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const ask = async () => {
    const request = { person, me, mine: mine.map((entry) => entry.title), transcript: transcript.trim() }
    if (!request.transcript) return
    setBusy(true)
    setProblem(null)
    const result = await window.api.ai.promiseDrafts({ requestId: `promise-drafts-${Date.now()}`, user: promiseDraftsUser(request) })
    setBusy(false)
    if (!result.success) {
      setProblem(result.error.message)
      return
    }
    const reference = localDateTimeOf(new Date())
    const checked = checkPromiseDrafts(result.data, request, (said) => readSaid(said, reference, navigator.language)?.date ?? null)
    setDrafts(checked)
    if (checked.length === 0) setProblem('No promise found in what was said.')
  }

  return (
    <div className="mt-3 rounded-card border border-border p-3" data-pro-promise-drafts>
      <label className="mb-1 block text-meta text-text-secondary" htmlFor="pro-promise-transcript">What was said</label>
      <textarea
        id="pro-promise-transcript"
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        rows={2}
        placeholder={`What ${person} and you agreed, in your words`}
        className="w-full resize-y rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={SMALL} disabled={busy || !transcript.trim()} onClick={() => void ask()}>
          <Sparkles className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          {busy ? 'Drafting…' : 'Draft promises'}
        </button>
        {problem && <span className="text-meta text-text-secondary">{problem}</span>}
      </div>
      {drafts.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {drafts.map((draft, index) => (
            <li key={index} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 text-meta text-text">
                <span className="text-text-secondary">{draft.mine ? 'You: ' : `${person}: `}</span>
                {draft.what}
                {draft.due && <span className="text-text-secondary">, {draft.due}</span>}
                {draft.words && <span className="italic text-text-secondary"> &ldquo;{draft.words}&rdquo;</span>}
              </span>
              <button
                type="button"
                className={SMALL}
                disabled={draft.added}
                onClick={() => {
                  const needs = draft.needs.flatMap((title) => mine.find((entry) => entry.title === title)?.id ?? [])
                  void onAdd(draft, needs).then(() => setDrafts((all) => all.map((entry, at) => (at === index ? { ...entry, added: true } : entry))))
                }}
              >
                {draft.added ? 'Added' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
