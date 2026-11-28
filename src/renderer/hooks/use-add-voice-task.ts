import { useCallback } from 'react'
import { useAppConfig } from './use-app-config'
import { useDateFormat } from './use-date-format'
import { useLabels } from './use-labels'
import { useProjects } from './use-projects'
import { useAddLabel, useCreateLabel, useCreateTask } from './use-task-mutations'
import { getParserConfig } from '@/lib/task-parser'
import { buildCreateExtras } from '@/lib/composer-queue'
import { isTempTaskId } from '@/lib/pending-cache'
import { voiceConfirmation, voiceTaskDraft, type VoiceListDefaults } from '@/lib/voice/voice-task'
import { toast } from '@/stores/toast-store'
import { t } from '../../shared/i18n'
import type { Label } from '@/lib/vikunja-types'

/**
 * Adds a spoken sentence as a task, the way quick add reads it with the list's composer defaults
 * (lib/voice/voice-task.ts), through
 * the same create as the composer: queued with its labels when the server cannot be reached.
 * Says what was added in a toast. Resolves true when a task was made.
 */
export function useAddVoiceTask(): (text: string, list?: VoiceListDefaults | null) => Promise<boolean> {
  const { data: config } = useAppConfig()
  const { data: projects } = useProjects()
  const { data: labels = [] } = useLabels()
  const dateFormat = useDateFormat()
  // A failed create shows the app's usual error toast.
  const createTask = useCreateTask()
  const addLabel = useAddLabel({ silent: true })
  const createLabel = useCreateLabel({ silent: true })

  return useCallback(async (text: string, list?: VoiceListDefaults | null) => {
    const draft = voiceTaskDraft(text, {
      parserConfig: getParserConfig(config ?? {}),
      projects: projects?.flat ?? [],
      inboxProjectId: config?.inbox_project_id ?? 0,
      list,
      defaultReminder: config,
    })
    if (!draft.ok) {
      toast.info(draft.message)
      return false
    }
    const extras = buildCreateExtras({
      explicitLabels: [],
      parsedLabelNames: draft.labelNames,
      knownLabels: labels,
      attachments: [],
      description: '',
    })
    let task
    try {
      task = await createTask.mutateAsync({ projectId: draft.projectId, task: draft.payload, extras })
    } catch {
      return false
    }
    // Online, the labels go on after the create (a queued create carries them in `extras`).
    if (!isTempTaskId(task.id) && draft.labelNames.length > 0) {
      let failed = 0
      for (const name of draft.labelNames) {
        try {
          const existing: Label | undefined = labels.find((label) => label.title.toLowerCase() === name.toLowerCase())
          const label = existing ?? await createLabel.mutateAsync({ title: name })
          await addLabel.mutateAsync({ taskId: task.id, labelId: label.id })
        } catch {
          failed++
        }
      }
      if (failed > 0) toast.error(failed === 1 ? t('voice.messages.labelFailed') : t('voice.messages.labelsFailed'))
    }
    toast.success(voiceConfirmation(draft, new Date(), dateFormat))
    return true
  }, [config, projects?.flat, labels, dateFormat, createTask, addLabel, createLabel])
}
