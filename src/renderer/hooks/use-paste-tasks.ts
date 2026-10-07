import { useCallback, useEffect, useRef } from 'react'
import { confirmDelete } from '@/lib/confirm-bridge'
import { buildCreateExtras } from '@/lib/composer-queue'
import { dateOnlyDue, toLocalDate } from '@/lib/due-dates'
import { describeMutationError } from '@/lib/mutation-errors'
import { isTempTaskId } from '@/lib/pending-cache'
import {
  createPastedTasks,
  pasteConfirmMessage,
  planPastedTask,
  splitPastedLines,
  type PastedTaskPlan,
} from '@/lib/paste-tasks'
import { toast } from '@/stores/toast-store'
import { useLabels } from './use-labels'
import { useParserConfig } from './use-parser-config'
import { useProjects } from './use-projects'
import { useAddLabel, useCreateLabel, useCreateTask } from './use-task-mutations'

interface UsePasteTasksOptions {
  /** The project of the list; pasting does nothing without one. */
  projectId?: number
  /** Given to a pasted line that names no date (the Today view's day, for one). */
  defaultDueDate?: Date
}

/**
 * Ctrl+V on a task list: one task per non-empty line of the clipboard (D-TL-1). Every line goes
 * through the natural-language parser, like the new-task composer. One line is created at once;
 * several are confirmed first, because pasting a page of text by accident should not create a
 * page of tasks. Returns a stable function so it can sit in a keyboard handler.
 */
export function usePasteTasks({ projectId, defaultDueDate }: UsePasteTasksOptions): () => Promise<void> {
  const parserConfig = useParserConfig()
  const { data: labels = [] } = useLabels()
  const { data: projects } = useProjects()
  // Failures are reported once, together, below; not one toast per task.
  const createTask = useCreateTask({ silent: true })
  const addLabel = useAddLabel({ silent: true })
  const createLabel = useCreateLabel({ silent: true })

  // The handler lives in a document listener: read the latest values when it runs.
  const latest = useRef({ projectId, defaultDueDate, parserConfig, labels, projects, createTask, addLabel, createLabel })
  useEffect(() => {
    latest.current = { projectId, defaultDueDate, parserConfig, labels, projects, createTask, addLabel, createLabel }
  })
  const running = useRef(false)

  return useCallback(async () => {
    const current = latest.current
    if (!current.projectId || running.current) return
    // Held until everything is done, the confirmation included: a second Ctrl+V while the dialog
    // is open must not stack another one.
    running.current = true
    try {
      let text = ''
      try {
        text = await navigator.clipboard.readText()
      } catch {
        return
      }
      const context = {
        projectId: current.projectId,
        projects: (current.projects?.flat ?? []).map((project) => ({ id: project.id, title: project.title })),
        parserConfig: current.parserConfig,
        defaultDueDate: current.defaultDueDate ? dateOnlyDue(toLocalDate(current.defaultDueDate)) : undefined,
      }
      const plans = splitPastedLines(text)
        .map((line) => planPastedTask(line, context))
        .filter((plan): plan is PastedTaskPlan => plan !== null)
      if (plans.length === 0) return

      if (plans.length > 1) {
        const ok = await confirmDelete(pasteConfirmMessage(plans.length), {
          force: true,
          confirmLabel: `Create ${plans.length} tasks`,
          destructive: false,
        })
        if (!ok) return
      }

      // Labels created for one line are known to the next.
      const knownLabels = [...current.labels]
      const result = await createPastedTasks(plans, {
        create: (plan) => {
          // If the server cannot be reached the create is queued with its labels.
          const extras = buildCreateExtras({
            explicitLabels: [],
            parsedLabelNames: plan.labelNames,
            knownLabels,
            attachments: [],
            description: '',
          })
          return current.createTask.mutateAsync({ projectId: plan.projectId, task: plan.payload, extras })
        },
        isQueued: (task) => isTempTaskId(task.id),
        applyLabels: async (taskId, names) => {
          let failed = false
          for (const name of names) {
            try {
              let label = knownLabels.find((entry) => entry.title.toLowerCase() === name.toLowerCase())
              if (!label) {
                label = await current.createLabel.mutateAsync({ title: name })
                knownLabels.push(label)
              }
              await current.addLabel.mutateAsync({ taskId, labelId: label.id })
            } catch {
              failed = true
            }
          }
          if (failed) throw new Error('Some labels could not be added')
        },
      })

      if (result.failed.length > 0) {
        const reason = describeMutationError(result.failed[0].error).message
        toast.error(
          plans.length === 1
            ? `Could not create the task. ${reason}`
            : `Created ${result.created} of ${plans.length} tasks. ${reason}`,
        )
      } else if (result.labelsFailed > 0) {
        toast.error('Tasks were created, but some labels could not be added.')
      }
    } finally {
      running.current = false
    }
  }, [])
}
