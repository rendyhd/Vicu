import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/shared/Button'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { TaskRow } from '@/components/task-list/TaskRow'
import { useFollowUps } from '@/hooks/use-follow-ups'
import { useGroups } from '@/hooks/use-groups'
import { usePromiseWorld } from '@/hooks/use-promise-world'
import { currentLedger, writeLedger } from '@/hooks/use-pro-ledger'
import { useOpenTask } from '@/hooks/use-open-task'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatDateChip } from '@/lib/date-utils'
import { checkedOperations, uncheckedOperations } from '@/lib/pro/follow-up-actions'
import { copyRendered, renderProDocument } from '@/lib/pro/text'
import { useProUiStore } from '@/stores/pro-ui-store'
import { toast } from '@/stores/toast-store'
import { localDateOf, startOfLocalDay, type LocalDate } from '../../../shared/due-dates'
import { ledgerSettings, recordValue } from '../../../shared/pro/ledger'
import { checkDocument, firstName, textLanguage } from '../../../shared/pro/documents'
import { effectiveDue } from '../../../shared/pro/promises'
import { sessionKindOf } from '../../../shared/pro/sessions'
import type { FollowUpLine } from '../../../shared/pro/follow-ups'

type Check = Extract<FollowUpLine, { kind: 'check' }>
type Bring = Extract<FollowUpLine, { kind: 'bring' }>
type Recap = Extract<FollowUpLine, { kind: 'recap' }>

const LINE = 'flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-b border-border px-6 py-2.5'

/**
 * The block at the top of Today (cross-app semantics 21.18): everything that needs a move from you,
 * in the order the rule gives. Nothing is shown without a line.
 */
export function FollowUps() {
  const { t } = useTranslation()
  const { lines, count, dismiss } = useFollowUps()
  const world = usePromiseWorld()
  const format = useDateFormat()
  if (lines.length === 0) return null

  const day = (value: LocalDate) => formatDateChip(startOfLocalDay(value), true, new Date(), format)
  const verdicts = lines.filter((line): line is Extract<FollowUpLine, { kind: 'verdict' }> => line.kind === 'verdict')
  const rest = lines.filter((line) => line.kind !== 'verdict')

  return (
    <div data-pro-follow-ups>
      <ListSectionHeader level={1} title={t('pro.followUps.title')} count={count} />
      {verdicts.length > 0 && (
        <div data-pro-promises-due><TaskRowGroup>
          {verdicts.map((line) => {
            const task = world.openById.get(line.taskId)
            return task ? <div key={line.key} role="presentation" data-pro-follow-up={line.key}><TaskRow task={task} /></div> : null
          })}
        </TaskRowGroup></div>
      )}
      {rest.map((line) => {
        if (line.kind === 'check') return <CheckLine key={line.key} line={line} day={day} onDismiss={() => dismiss(line)} />
        if (line.kind === 'bring') return <BringLine key={line.key} line={line} day={day} onDismiss={() => dismiss(line)} />
        if (line.kind === 'recap') return <RecapLine key={line.key} line={line} day={day} onDismiss={() => dismiss(line)} />
        if (line.kind === 'note') {
          return (
            <div key={line.key} className={LINE} data-pro-follow-up={line.key}>
              <p className="min-w-0 flex-1 text-task-title text-text">{t('pro.followUps.note')}</p>
              <div className="flex shrink-0 gap-1.5">
                <Button variant="secondary" data-pro-follow-up-note onClick={() => useProUiStore.getState().open('pro-weekly-note')}>{t('pro.followUps.writeIt')}</Button>
                <Button variant="quiet" data-pro-follow-up-dismiss onClick={() => dismiss(line)}>{t('pro.followUps.dismiss')}</Button>
              </div>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

function CheckLine({ line, day, onDismiss }: { line: Check; day: (value: LocalDate) => string; onDismiss: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const world = usePromiseWorld()
  const groups = useGroups()
  const name = world.nameOf(line.person)
  const tasks = line.tasks.flatMap((id) => {
    const task = world.openById.get(id)
    return task ? [task] : []
  })

  const copy = async () => {
    const ledger = currentLedger(queryClient)
    const items = tasks.map((task) => ({ title: task.title, due: effectiveDue(task, recordValue(ledger.promises, task.id)) }))
    const document = checkDocument(name, items)
    if (!document) return
    // The group of the first action, by its lowest group label, decides the language.
    const labels = (tasks[0]?.labels ?? []).map((label) => label.id).filter((id) => groups.byLabel.has(id)).sort((a, b) => a - b)
    const group = labels.length ? groups.byLabel.get(labels[0]) ?? null : null
    const rendered = await renderProDocument(document, textLanguage(group, ledgerSettings(ledger)))
    try {
      await copyRendered(rendered)
    } catch {
      toast.error(t('pro.followUps.copyFailed'))
      return
    }
    const at = new Date().toISOString()
    const ids = tasks.map((task) => task.id)
    const ok = await writeLedger(queryClient, checkedOperations(currentLedger(queryClient), ids, at))
    if (!ok) return
    toast.success(t('pro.followUps.copied', { count: ids.length }), {
      action: {
        label: t('pro.followUps.undo'),
        onAction: () => void writeLedger(queryClient, uncheckedOperations(currentLedger(queryClient), ids, at)),
      },
    })
  }

  return (
    <div className={LINE} data-pro-follow-up={line.key}>
      <div className="min-w-0 flex-1">
        <p className="text-task-title text-text">{t('pro.followUps.check', { name: firstName(name), count: line.tasks.length, date: day(line.due) })}</p>
        <ul className="mt-0.5 space-y-0.5">
          {tasks.map((task) => <li key={task.id} className="truncate text-meta text-text-secondary">{task.title}</li>)}
        </ul>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="secondary" data-pro-follow-up-copy onClick={() => void copy()}>{t('pro.followUps.copyMessage')}</Button>
        <Button variant="quiet" data-pro-follow-up-dismiss onClick={onDismiss}>{t('pro.followUps.dismiss')}</Button>
      </div>
    </div>
  )
}

function BringLine({ line, day, onDismiss }: { line: Bring; day: (value: LocalDate) => string; onDismiss: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const world = usePromiseWorld()
  const openTask = useOpenTask()
  const task = world.openById.get(line.taskId)
  if (!task) return null

  const checked = () => {
    const at = new Date().toISOString()
    void writeLedger(queryClient, checkedOperations(currentLedger(queryClient), [task.id], at)).then((ok) => {
      if (!ok) return
      toast.success(t('pro.followUps.checkedToast', { title: task.title }), {
        action: {
          label: t('pro.followUps.undo'),
          onAction: () => void writeLedger(queryClient, uncheckedOperations(currentLedger(queryClient), [task.id], at)),
        },
      })
    })
  }

  return (
    <div className={LINE} data-pro-follow-up={line.key}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-task-title text-text">{t('pro.followUps.bring', { title: task.title })}</p>
        <p className="text-meta text-text-secondary">
          {line.person !== null ? t('pro.followUps.bringMeta', { name: world.nameOf(line.person), date: day(line.checkOn) }) : t('pro.followUps.bringMetaNoOne', { date: day(line.checkOn) })}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="secondary" data-pro-follow-up-checked onClick={checked}>{t('pro.followUps.checked')}</Button>
        <Button variant="secondary" data-pro-follow-up-open onClick={() => openTask(task.id)}>{t('pro.followUps.open')}</Button>
        <Button variant="quiet" data-pro-follow-up-dismiss onClick={onDismiss}>{t('pro.followUps.dismiss')}</Button>
      </div>
    </div>
  )
}

function RecapLine({ line, day, onDismiss }: { line: Recap; day: (value: LocalDate) => string; onDismiss: () => void }) {
  const { t } = useTranslation()
  const groups = useGroups()
  const world = usePromiseWorld()
  const name = groups.byMeeting.get(line.meeting)?.name ?? ''
  const round = recordValue(world.ledger.rounds, line.round)
  const date = day(localDateOf(line.ended))
  const text = sessionKindOf(round?.kind) === 'standup'
    ? t('pro.followUps.recapStandup', { group: name, date })
    : t('pro.followUps.recapWeekly', { group: name, date })
  return (
    <div className={LINE} data-pro-follow-up={line.key}>
      <p className="min-w-0 flex-1 text-task-title text-text">{text}</p>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="secondary" data-pro-follow-up-recap onClick={() => useProUiStore.getState().open('pro-session-recap', { roundId: line.round })}>{t('pro.followUps.openRecap')}</Button>
        <Button variant="quiet" data-pro-follow-up-dismiss onClick={onDismiss}>{t('pro.followUps.dismiss')}</Button>
      </div>
    </div>
  )
}
