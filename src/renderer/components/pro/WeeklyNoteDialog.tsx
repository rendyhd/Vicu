import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useTasks } from '@/hooks/use-tasks'
import { useGroups, ledgerInArea } from '@/hooks/use-groups'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { useCollabMe } from '@/hooks/use-project-access'
import { currentLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { toast } from '@/stores/toast-store'
import { copyRendered, renderProDocument } from '@/lib/pro/text'
import { availableLanguages, languageName } from '../../../shared/i18n'
import { addLocalDays, startOfLocalDay, toLocalDate } from '../../../shared/due-dates'
import { ledgerSettings, type LedgerSettingsValue } from '../../../shared/pro/ledger'
import { textLanguage, weeklyNoteDocument, type RenderedDocument } from '../../../shared/pro/documents'
import { notePeriod } from '../../../shared/pro/follow-ups'

/** The settings with the weekly note copied at `at`. */
export function withNoteSent(settings: LedgerSettingsValue | null | undefined, at: string): Record<string, unknown> {
  return { ...(settings ?? {}), note_sent: [...new Set([...(settings?.note_sent ?? []), at])].sort() }
}

/** Undo of that copy: only its own mark goes. */
export function withoutNoteSent(settings: LedgerSettingsValue | null | undefined, at: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(settings ?? {}) }
  const left = (settings?.note_sent ?? []).filter((mark) => mark !== at)
  if (left.length) next.note_sent = left
  else delete next.note_sent
  return next
}

/**
 * The weekly note (cross-app semantics 21.19): per group what was delivered, what slipped, what was
 * decided and what is still open, as counts and lines, to paste into a mail. Copying records when,
 * so the next note starts the day after and the follow-up line goes away.
 */
export function WeeklyNoteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const world = usePromiseWorld()
  const groups = useGroups()
  const me = useCollabMe()
  const today = toLocalDate(new Date())
  const settings = ledgerSettings(world.ledger)
  const sentKey = (settings.note_sent ?? []).join(',')
  const period = useMemo(() => notePeriod(settings, today), [sentKey, today])
  const [language, setLanguage] = useState<string | null>(null)
  const [rendered, setRendered] = useState<RenderedDocument | null>(null)
  const used = language ?? textLanguage(null, settings)
  const myName = me?.name || me?.username || t('pro.group.you')
  const labelIds = useMemo(() => [...groups.labelIds].sort((a, b) => a - b), [groups.labelIds])

  const doneParams = useMemo(
    () => ({
      filter: `done = true && (${labelIds.map((id) => `labels = ${id}`).join(' || ') || 'labels = 0'}) && done_at >= '${startOfLocalDay(addLocalDays(period.from, -1)).toISOString()}'`,
      keep_nested_subtasks: true,
    }),
    [labelIds, period.from],
  )
  const done = useTasks(doneParams, world.on && labelIds.length > 0)

  const document = useMemo(() => {
    const open = world.open.filter((task) => (task.labels ?? []).some((label) => groups.labelIds.has(label.id)))
    const tasks = [...open, ...(done.data ?? []).filter((task) => task.done)]
    return weeklyNoteDocument({
      groups: groups.groups,
      tasks,
      ledger: ledgerInArea(world, tasks),
      from: period.from,
      to: period.to,
      names: { person: world.nameOf, me: myName },
    })
  }, [world, groups, done.data, period, myName])

  useEffect(() => {
    let live = true
    void renderProDocument(document, used).then((text) => { if (live) setRendered(text) })
    return () => { live = false }
  }, [document, used])

  const copy = async (form: 'rich' | 'markdown') => {
    if (!rendered) return
    await copyRendered(rendered, form)
    const at = new Date().toISOString()
    await writeLedger(queryClient, [{ op: 'settings', value: withNoteSent(currentLedger(queryClient).settings?.value, at) }])
    toast.success(t('pro.note.copied'), {
      action: {
        label: t('pro.note.undo'),
        onAction: () => void writeLedger(queryClient, [{ op: 'settings', value: withoutNoteSent(currentLedger(queryClient).settings?.value, at) }]),
      },
    })
    onClose()
  }

  return (
    <Dialog open label={t('pro.note.title')} onClose={onClose} className="w-[640px] max-w-[92vw] p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="min-w-0 flex-1 text-card-title text-text">{t('pro.note.title')}</h2>
        <label className="flex items-center gap-2 text-meta text-text-secondary">
          {t('pro.note.language')}
          <select value={used} onChange={(event) => setLanguage(event.target.value)} className="rounded-control border border-border bg-bg-page px-2 py-1 text-meta text-text" data-pro-note-language>
            {[...new Set(['en', used, ...availableLanguages(false)])].map((tag) => <option key={tag} value={tag}>{languageName(tag)}</option>)}
          </select>
        </label>
      </div>
      {rendered ? (
        <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-card border border-border bg-bg-hover p-3 font-sans text-meta text-text" data-pro-weekly-note>
          {rendered.text}
        </pre>
      ) : (
        <p className="py-6 text-meta text-text-secondary">{t('pro.note.loading')}</p>
      )}
      <p className="mt-2 text-caption text-text-secondary">{t('pro.note.hint')}</p>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>{t('pro.note.close')}</Button>
        <Button variant="secondary" disabled={!rendered} onClick={() => void copy('markdown')} data-pro-note-copy-markdown>{t('pro.note.copyMarkdown')}</Button>
        <Button variant="primary" disabled={!rendered} onClick={() => void copy('rich')} data-pro-note-copy>{t('pro.note.copy')}</Button>
      </div>
    </Dialog>
  )
}
