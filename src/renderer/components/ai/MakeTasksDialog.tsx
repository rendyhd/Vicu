import { useEffect, useId, useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useAiReady, useAiWorkspace } from '@/hooks/use-ai'
import { listInfoOf } from '@/lib/ai/workspace'
import { toLocalDate } from '@/lib/due-dates'
import { useAiUiStore } from '@/stores/ai-ui-store'
import { useDictationStore } from '@/stores/dictation-store'
import { useVoiceListStore } from '@/stores/voice-list-store'

/**
 * "Make tasks from this" (docs/ai-assistant-v1.md section 4): text from outside (an email, notes,
 * a pasted list) goes through the dictation request and comes back as draft cards.
 */
export function MakeTasksDialog() {
  const { t } = useTranslation()
  const text = useAiUiStore((s) => s.makeTasksText)
  const close = useAiUiStore((s) => s.closeMakeTasks)
  const ready = useAiReady()
  const ws = useAiWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const titleId = useId()
  const [value, setValue] = useState('')

  useEffect(() => {
    if (text !== null) setValue(text)
  }, [text])

  if (text === null) return null

  const submit = () => {
    const words = value.trim()
    if (!words) return
    close()
    useDictationStore.getState().open({
      transcript: words,
      list: listInfoOf(pathname, ws, useVoiceListStore.getState().defaults, toLocalDate),
      source: 'text',
    })
  }

  return (
    <Dialog open onClose={close} labelledBy={titleId} className="w-[520px] max-w-[92vw]">
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-card-title text-[var(--text-primary)]">{t('ai.makeTasks.title')}</h2>
        {!ready.dictation ? (
          <p className="text-meta text-[var(--text-secondary)]">
            {t('ai.makeTasks.needsDictation')}
          </p>
        ) : (
          <>
            <p className="text-meta text-[var(--text-secondary)]">
              {t('ai.makeTasks.intro')}
            </p>
            <textarea
              data-autofocus=""
              aria-label={t('ai.makeTasks.textLabel')}
              rows={8}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  submit()
                }
              }}
              className="w-full resize-y rounded-control border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-task-title text-[var(--text-primary)]"
            />
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={close}>{t('ai.makeTasks.cancel')}</Button>
          {ready.dictation && <Button variant="primary" disabled={!value.trim()} onClick={submit}>{t('ai.makeTasks.submit')}</Button>}
        </div>
      </div>
    </Dialog>
  )
}
