import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useGroups, useGroupWorld } from '@/hooks/use-groups'
import { useCollabMe } from '@/hooks/use-project-access'
import { currentLedger, setRecord, useProLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { toast } from '@/stores/toast-store'
import { copyRendered, renderProDocument } from '@/lib/pro/text'
import { availableLanguages, languageName } from '../../../shared/i18n'
import { ledgerSettings, recordValue, type ProLedger } from '../../../shared/pro/ledger'
import { recapDocument, textLanguage, type RenderedDocument } from '../../../shared/pro/documents'
import { withoutMark, withSent } from '../../../shared/pro/promises'
import { withoutRecapSent, withRecapSent } from '../../../shared/pro/sessions'
import type { ProLedgerOperation } from '../../../shared/pro/ledger-ipc'

/** The marks a copied recap leaves: on the round, on the promises in it, on its decisions. */
export function recapSentOperations(ledger: ProLedger, roundId: string, taskIds: readonly number[], decisionIds: readonly string[], at: string): ProLedgerOperation[] {
  const round = recordValue(ledger.rounds, roundId)
  return [
    ...(round ? [setRecord('rounds', roundId, withRecapSent(round, at))] : []),
    ...taskIds.flatMap((id) => {
      const promise = recordValue(ledger.promises, id)
      return promise ? [setRecord('promises', id, withSent(promise, at))] : []
    }),
    ...decisionIds.flatMap((id) => {
      const entry = recordValue(ledger.log, id)
      return entry ? [setRecord('log', id, { ...entry, shared: [...new Set([...(entry.shared ?? []), at])].sort() })] : []
    }),
  ]
}

/** Undo of those marks: only the marks of this copy go, whatever else changed since stays. */
export function recapUnsentOperations(ledger: ProLedger, roundId: string, taskIds: readonly number[], decisionIds: readonly string[], at: string): ProLedgerOperation[] {
  const round = recordValue(ledger.rounds, roundId)
  return [
    ...(round ? [setRecord('rounds', roundId, withoutRecapSent(round, at))] : []),
    ...taskIds.flatMap((id) => {
      const promise = recordValue(ledger.promises, id)
      return promise ? [setRecord('promises', id, withoutMark(promise, 'sent', at))] : []
    }),
    ...decisionIds.flatMap((id) => {
      const entry = recordValue(ledger.log, id)
      if (!entry) return []
      const left = (entry.shared ?? []).filter((mark) => mark !== at)
      const next = { ...entry }
      if (left.length) next.shared = left
      else delete next.shared
      return [setRecord('log', id, next)]
    }),
  ]
}

/**
 * The recap of one session (cross-app semantics 21.17 and 21.19): what was decided and changed in
 * it, in the group's language, to paste into a mail or a chat. Copying marks the round, the
 * promises in it and its decisions, with Undo.
 */
export function SessionRecapDialog({ roundId, onClose }: { roundId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const groups = useGroups()
  const me = useCollabMe()
  const round = recordValue(useProLedger().ledger.rounds, roundId)
  const group = round ? groups.byMeeting.get(round.meeting) ?? null : null
  const view = useGroupWorld(group?.label ?? 0)
  const [language, setLanguage] = useState<string | null>(null)
  const [rendered, setRendered] = useState<RenderedDocument | null>(null)
  const used = language ?? textLanguage(group, ledgerSettings(view.ledger))
  const myName = me?.name || me?.username || t('pro.group.you')

  const recap = useMemo(() => {
    if (!round || !group || typeof round.started !== 'string' || typeof round.ended !== 'string') return null
    return recapDocument({
      group,
      kind: round.kind ?? 'weekly',
      date: round.at,
      tasks: view.tasks,
      ledger: view.ledger,
      names: { person: view.world.nameOf, me: myName },
      round: roundId,
      started: round.started,
      ended: round.ended,
      absent: round.absent,
    })
  }, [round, group, view.tasks, view.ledger, view.world.nameOf, myName, roundId])

  useEffect(() => {
    let live = true
    if (recap) void renderProDocument(recap.document, used).then((text) => { if (live) setRendered(text) })
    return () => { live = false }
  }, [recap, used])

  const copy = async (form: 'rich' | 'markdown') => {
    if (!recap || !rendered) return
    await copyRendered(rendered, form)
    const at = new Date().toISOString()
    await writeLedger(queryClient, recapSentOperations(currentLedger(queryClient), roundId, recap.taskIds, recap.decisionIds, at))
    toast.success(t('pro.session.recap.copied', { count: recap.taskIds.length }), {
      action: {
        label: t('pro.session.recap.undo'),
        onAction: () => void writeLedger(queryClient, recapUnsentOperations(currentLedger(queryClient), roundId, recap.taskIds, recap.decisionIds, at)),
      },
    })
    onClose()
  }

  return (
    <Dialog open label={t('pro.session.recap.title')} onClose={onClose} className="w-[640px] max-w-[92vw] p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="min-w-0 flex-1 text-card-title text-text">{t('pro.session.recap.title')}</h2>
        <label className="flex items-center gap-2 text-meta text-text-secondary">
          {t('pro.session.recap.language')}
          <select value={used} onChange={(event) => setLanguage(event.target.value)} className="rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text" data-pro-recap-language>
            {[...new Set(['en', used, ...availableLanguages(false)])].map((tag) => <option key={tag} value={tag}>{languageName(tag)}</option>)}
          </select>
        </label>
      </div>
      {recap && rendered ? (
        <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-card border border-border bg-bg-hover p-3 font-sans text-meta text-text" data-pro-session-recap>
          {rendered.text}
        </pre>
      ) : (
        <p className="py-6 text-meta text-text-secondary">{view.isLoading ? t('pro.session.recap.loading') : t('pro.session.recap.missing')}</p>
      )}
      <p className="mt-2 text-caption text-text-secondary">{t('pro.session.recap.note')}</p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>{t('pro.session.recap.later')}</Button>
        <Button variant="secondary" disabled={!rendered} onClick={() => void copy('markdown')} data-pro-recap-copy-markdown>{t('pro.session.recap.copyMarkdown')}</Button>
        <Button variant="primary" disabled={!rendered} onClick={() => void copy('rich')} data-pro-recap-copy>{t('pro.session.recap.copy')}</Button>
      </div>
    </Dialog>
  )
}
