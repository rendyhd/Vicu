import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { isTempTaskId } from '@/lib/pending-cache'
import { routeForTask } from '@/lib/open-task'
import { refreshTasks } from '@/lib/task-refresh'
import type { CreateTaskPayload, Task, TaskReminder } from '@/lib/vikunja-types'
import { useSelectionStore } from '@/stores/selection-store'
import { useTemplateEditStore } from '@/stores/template-edit-store'
import { toast, UNDO_TOAST_MS, useToastStore } from '@/stores/toast-store'
import { withDefaultReminder } from '../../shared/default-reminder'
import { toLocalDate } from '../../shared/due-dates'
import { readSubtaskOrder, sortSubtasks, subtaskOrderKey } from '../../shared/subtask-order'
import {
  captureTemplate,
  encodeTemplate,
  isTemplateTooLarge,
  readTemplates,
  templateDueDate,
  templateKey,
  templateProject,
  type ListedTemplate,
  type TaskTemplate,
  type TemplateSource,
} from '../../shared/task-templates'
import { useAppConfig } from './use-app-config'
import { useLabels } from './use-labels'
import { useProjects } from './use-projects'
import { useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'
import { useAddLabel, useCreateTask } from './use-task-mutations'

/** The account's templates, oldest first (section 18). */
export function useTaskTemplates(): ListedTemplate[] {
  const { snapshot } = useSyncedPrefs()
  return useMemo(() => readTemplates(snapshot.values), [snapshot.values])
}

/** A task with its subtasks as the server has them; a relation cycle stops at the task already taken. */
async function sourceOf(task: Task, visited: Set<number>, prefs: Readonly<Record<string, unknown>>): Promise<TemplateSource> {
  const result = await api.fetchTaskById(task.id)
  const full = result.success ? result.data : task
  const children: TemplateSource[] = []
  const order = readSubtaskOrder(prefs[subtaskOrderKey(full.id)])
  for (const child of sortSubtasks(full.related_tasks?.subtask ?? [], order)) {
    if (visited.has(child.id)) continue
    visited.add(child.id)
    children.push(await sourceOf(child, visited, prefs))
  }
  return { ...full, subtasks: children }
}

/** The fields of a new task that a template sets. */
function payloadOf(template: TaskTemplate, today: string): CreateTaskPayload {
  const payload: CreateTaskPayload = { title: template.title }
  if (template.notes) payload.description = template.notes
  const due = templateDueDate(template.due, today)
  if (due) payload.due_date = due
  if (template.priority) payload.priority = template.priority
  if (template.repeat_after) payload.repeat_after = template.repeat_after
  if (template.repeat_mode) payload.repeat_mode = template.repeat_mode
  if (template.reminders?.length) payload.reminders = template.reminders as TaskReminder[]
  return payload
}

export function useTemplateActions() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const createTask = useCreateTask({ silent: true })
  const addLabel = useAddLabel({ silent: true })
  const { data: labels = [] } = useLabels()
  const { data: projects } = useProjects()
  const { data: appConfig } = useAppConfig()
  const openEdit = useTemplateEditStore((state) => state.open)
  const { snapshot } = useSyncedPrefs()

  /** Writes `template` under its id; false when it is too large to keep. */
  const write = useCallback(async (id: string, template: TaskTemplate): Promise<boolean> => {
    if (isTemplateTooLarge(template)) {
      toast.error('This template is too long to save')
      return false
    }
    return writeSyncedPrefs(queryClient, { [templateKey(id)]: encodeTemplate(template) })
  }, [queryClient])

  /** Save as template (section 18.1): at once, with Edit in the answer. */
  const saveFrom = useCallback(async (task: Task) => {
    const source = await sourceOf(task, new Set([task.id]), snapshot.values)
    const template = { ...captureTemplate(source, toLocalDate(new Date())), created_ms: Date.now() }
    if (isTemplateTooLarge(template)) {
      toast.error('This task is too long to save as a template')
      return
    }
    const id = crypto.randomUUID()
    if (await write(id, template)) {
      toast.success('Saved as a template', { action: { label: 'Edit', onAction: () => openEdit(id) } })
    }
  }, [write, openEdit, snapshot.values])

  /** Removes a template, with Undo. */
  const remove = useCallback(async (template: ListedTemplate) => {
    const { id } = template
    if (await writeSyncedPrefs(queryClient, { [templateKey(id)]: null })) {
      useToastStore.getState().push('info', `Removed “${template.title}”`, {
        durationMs: UNDO_TOAST_MS,
        action: { label: 'Undo', onAction: () => { void write(id, template) } },
      })
    }
  }, [queryClient, write])

  /**
   * Makes a task from `template` (section 18.2) and opens it with its title selected. A subtask
   * relation needs both tasks on the server, so a task made offline goes without its subtasks and
   * says so, as Duplicate does.
   */
  const make = useCallback(async (template: TaskTemplate, fallbackProjectId: number) => {
    const today = toLocalDate(new Date())
    const writable = new Set((projects?.flat ?? []).filter((project) => (project.max_permission ?? 1) >= 1).map((project) => project.id))
    const problems: string[] = []

    const labelsOf = (node: TaskTemplate) => labels.filter((label) => node.labels?.includes(label.id))
    const create = async (node: TaskTemplate, projectId: number, payload: CreateTaskPayload): Promise<Task> => {
      const nodeLabels = labelsOf(node)
      const task = await createTask.mutateAsync({
        projectId,
        task: payload,
        extras: { labels: nodeLabels.map((label) => ({ id: label.id, title: label.title })), displayLabels: nodeLabels },
      })
      // A queued create carries its labels; a created one gets them now.
      if (!isTempTaskId(task.id)) {
        for (const label of nodeLabels) {
          try {
            await addLabel.mutateAsync({ taskId: task.id, labelId: label.id })
          } catch {
            problems.push(`A label could not be added to “${task.title}”.`)
          }
        }
      }
      for (const subtask of node.subtasks ?? []) {
        if (isTempTaskId(task.id)) {
          problems.push(`“${task.title}” was saved offline, so its subtasks were not added.`)
          break
        }
        try {
          const child = await create(subtask, projectId, payloadOf(subtask, today))
          const relation = isTempTaskId(child.id) ? null : await api.createTaskRelation(task.id, child.id, 'subtask')
          if (!relation?.success) problems.push(`A subtask of “${task.title}” could not be added.`)
        } catch {
          problems.push(`A subtask of “${task.title}” could not be added.`)
        }
      }
      return task
    }

    const projectId = templateProject(template, writable, fallbackProjectId)
    let task: Task
    try {
      task = await create(template, projectId, withDefaultReminder(payloadOf(template, today), appConfig))
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not make the task')
      return
    }
    refreshTasks(queryClient)
    if (problems.length > 0) toast.error(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`)
    const selection = useSelectionStore.getState()
    selection.selectTitleOf(task.id)
    selection.requestOpenTask(task.id)
    void navigate(routeForTask(task, appConfig?.inbox_project_id ?? 0))
  }, [projects, labels, createTask, addLabel, appConfig, queryClient, navigate])

  return { write, saveFrom, remove, make }
}
