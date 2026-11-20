import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { Checkbox } from '@/components/shared/Checkbox'
import { usePersonLabels } from '@/hooks/use-people'
import { useLabels } from '@/hooks/use-labels'
import { useProPrefs } from '@/hooks/use-pro-prefs'
import { useGroupActions, useGroups } from '@/hooks/use-groups'
import { newLedgerId } from '@/hooks/use-pro-ledger'
import { availableLanguages, languageName } from '../../../shared/i18n'
import type { Group } from '../../../shared/pro/groups'
import type { GroupSession } from '../../../shared/pro/ledger'
import { SESSION_KINDS, type SessionKind } from '../../../shared/pro/sessions'

const FIELD = 'w-full rounded-control border border-border bg-bg-page px-2 py-1.5 text-meta text-text'

export interface GroupDialogProps {
  /** The group to change; a new one without it. */
  group?: Group | null
  /** A plain meeting to make a group of: its name and people are the start. */
  fromMeeting?: { id: string; name: string; people: number[] } | null
  /** A label to make a group of (from the label's menu). */
  label?: number | null
  onClose: () => void
  onSaved?: (labelId: number) => void
}

/**
 * A group (cross-app semantics 21.16): a label, a name, its people in order, the sessions it holds,
 * whether its actions get a check before they are due, and the language of text copied for it.
 */
export function GroupDialog({ group, fromMeeting, label, onClose, onSaved }: GroupDialogProps) {
  const { t } = useTranslation()
  const people = usePersonLabels()
  const { data: labels = [] } = useLabels()
  const prefs = useProPrefs()
  const { labelIds } = useGroups()
  const { save, unmark } = useGroupActions()
  const startLabel = group?.label ?? label ?? null
  const [name, setName] = useState(group?.name ?? fromMeeting?.name ?? labels.find((entry) => entry.id === label)?.title ?? '')
  const [labelId, setLabelId] = useState<number | null>(startLabel)
  const [order, setOrder] = useState<number[]>(group?.people ?? fromMeeting?.people ?? [])
  const [kinds, setKinds] = useState<SessionKind[]>(() => {
    const have = (group?.sessions ?? []).map((session) => session.kind)
    return group ? SESSION_KINDS.filter((kind) => have.includes(kind)) : ['weekly']
  })
  const [checks, setChecks] = useState(group?.checks ?? true)
  const [language, setLanguage] = useState(group?.language ?? '')
  const [saving, setSaving] = useState(false)
  const others = [...people.values()].filter((entry) => !order.includes(entry.id))
  // A label that is a person or already a group cannot be this group's label.
  const freeLabels = labels.filter((entry) => entry.id === startLabel || (!prefs.isPerson(entry.id) && !labelIds.has(entry.id)))
  const kindName: Record<SessionKind, string> = { weekly: t('pro.group.kind.weekly'), standup: t('pro.group.kind.standup') }

  const move = (index: number, by: number) => {
    const next = [...order]
    const [entry] = next.splice(index, 1)
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, entry)
    setOrder(next)
  }

  const submit = async () => {
    setSaving(true)
    // A session keeps its id; a kind this screen does not show stays as it is.
    const kept = (group?.sessions ?? []).filter((session) => !(SESSION_KINDS as readonly string[]).includes(session.kind) || kinds.includes(session.kind as SessionKind))
    const added: GroupSession[] = kinds.filter((kind) => !kept.some((session) => session.kind === kind)).map((kind) => ({ id: newLedgerId(), kind }))
    const saved = await save({
      id: group?.id ?? fromMeeting?.id,
      label: labelId,
      name,
      people: order,
      sessions: [...kept, ...added],
      checks,
      language: language || null,
    })
    setSaving(false)
    if (saved === null) return
    onSaved?.(saved)
    onClose()
  }

  return (
    <Dialog open label={group ? t('pro.group.dialog.edit') : t('pro.group.dialog.new')} onClose={onClose} className="w-[460px] max-w-[92vw] p-5">
      <h2 className="mb-3 text-card-title text-text">{group ? t('pro.group.dialog.edit') : t('pro.group.dialog.new')}</h2>
      <label className="mb-3 block">
        <span className="mb-1 block text-group text-text-secondary">{t('pro.group.dialog.name')}</span>
        <input value={name} onChange={(event) => setName(event.target.value)} autoFocus className={FIELD} data-pro-group-name />
      </label>
      {!group && (
        <label className="mb-3 block">
          <span className="mb-1 block text-group text-text-secondary">{t('pro.group.dialog.label')}</span>
          <select value={labelId ?? ''} onChange={(event) => setLabelId(event.target.value ? Number(event.target.value) : null)} className={FIELD} data-pro-group-label>
            <option value="">{t('pro.group.dialog.newLabel')}</option>
            {freeLabels.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
          </select>
          <span className="mt-1 block text-caption text-text-secondary">{t('pro.group.dialog.labelHint')}</span>
        </label>
      )}
      <p className="mb-1 text-group text-text-secondary">{t('pro.group.dialog.people')}</p>
      <ul className="mb-2 space-y-1">
        {order.map((personId, index) => {
          const person = people.get(personId)?.title ?? t('pro.group.someone')
          return (
            <li key={personId} className="flex items-center gap-2 rounded-control border border-border px-2 py-1 text-meta text-text">
              <span className="min-w-0 flex-1 truncate">{person}</span>
              <button type="button" aria-label={t('pro.group.dialog.earlier', { name: person })} disabled={index === 0} onClick={() => move(index, -1)} className="rounded-control p-0.5 hover:bg-bg-hover disabled:opacity-30"><ArrowUp className="h-3 w-3" aria-hidden /></button>
              <button type="button" aria-label={t('pro.group.dialog.later', { name: person })} disabled={index === order.length - 1} onClick={() => move(index, 1)} className="rounded-control p-0.5 hover:bg-bg-hover disabled:opacity-30"><ArrowDown className="h-3 w-3" aria-hidden /></button>
              <button type="button" aria-label={t('pro.group.dialog.remove', { name: person })} onClick={() => setOrder(order.filter((entry) => entry !== personId))} className="rounded-control p-0.5 hover:bg-bg-hover"><X className="h-3 w-3" aria-hidden /></button>
            </li>
          )
        })}
      </ul>
      {others.length > 0 && (
        <select value="" onChange={(event) => event.target.value && setOrder([...order, Number(event.target.value)])} aria-label={t('pro.group.dialog.addPerson')} className={`mb-3 ${FIELD}`} data-pro-group-add-person>
          <option value="">{t('pro.group.dialog.addPerson')}</option>
          {others.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select>
      )}
      <fieldset className="mb-3">
        <legend className="mb-1 text-group text-text-secondary">{t('pro.group.dialog.sessions')}</legend>
        <div className="flex flex-wrap gap-4">
          {SESSION_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-2 text-meta text-text">
              <Checkbox checked={kinds.includes(kind)} onChange={(event) => setKinds(event.target.checked ? [...kinds, kind] : kinds.filter((entry) => entry !== kind))} />
              {kindName[kind]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mb-3 flex items-start gap-2 text-meta text-text">
        <Checkbox checked={checks} onChange={(event) => setChecks(event.target.checked)} className="mt-0.5" />
        <span>
          {t('pro.group.dialog.checks')}
          <span className="block text-caption text-text-secondary">{t('pro.group.dialog.checksHint')}</span>
        </span>
      </label>
      <label className="mb-4 block">
        <span className="mb-1 block text-group text-text-secondary">{t('pro.group.dialog.language')}</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value)} className={FIELD} data-pro-group-language>
          <option value="">{t('pro.group.dialog.languageDefault')}</option>
          {availableLanguages(false).map((tag) => <option key={tag} value={tag}>{languageName(tag)}</option>)}
        </select>
      </label>
      <div className="flex items-center justify-end gap-2">
        {group && (
          <Button variant="quiet" className="mr-auto" onClick={() => { void unmark(group); onClose() }}>{t('pro.group.dialog.unmark')}</Button>
        )}
        <Button variant="quiet" onClick={onClose}>{t('pro.group.dialog.cancel')}</Button>
        <Button variant="primary" disabled={!name.trim() || saving} onClick={() => void submit()} data-pro-group-save>{t('pro.group.dialog.save')}</Button>
      </div>
    </Dialog>
  )
}
