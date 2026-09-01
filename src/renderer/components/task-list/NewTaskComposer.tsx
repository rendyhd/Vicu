import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignLeft,
  Bell,
  CalendarDays,
  Flag,
  FolderOpen,
  Loader2,
  Paperclip,
  Send,
  Tags,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { NULL_DATE } from '@/lib/constants'
import { replacePendingTokens } from '@/lib/image-tokens'
import { recurrenceToVikunja } from '@/lib/task-parser'
import { useTaskParser } from '@/hooks/use-task-parser'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import {
  useAddLabel,
  useCreateLabel,
  useCreateTask,
  useUpdateTask,
  useUploadAttachmentFromPaste,
} from '@/hooks/use-task-mutations'
import type { CreateTaskPayload, Label, Task, TaskReminder } from '@/lib/vikunja-types'
import type { ChipData } from '@/components/task-input/TokenChip'
import { TaskInputParser } from '@/components/task-input/TaskInputParser'
import { TaskDescription, type PendingImage } from './TaskDescription'
import { DatePickerPopover } from './DatePickerPopover'
import { PriorityPickerPopover, PRIORITY_OPTIONS } from './PriorityPickerPopover'
import { ProjectPickerPopover } from './ProjectPickerPopover'
import { ReminderPickerPopover } from './ReminderPickerPopover'
import { DraftLabelPickerPopover } from './DraftLabelPickerPopover'

type OpenPicker = 'date' | 'reminder' | 'priority' | 'labels' | 'project' | null

interface DraftAttachment {
  id: string
  name: string
  mime: string
  bytes: Uint8Array
  pendingToken?: string
  blobUrl?: string
}

interface PartialFailure {
  taskId: number
  labels: Array<{ id?: number; name: string }>
  attachments: DraftAttachment[]
  descriptionPatch?: string
}

export interface NewTaskComposerProps {
  projectId: number
  defaultDueDate?: Date
  inputRef?: React.Ref<HTMLInputElement>
  onCancel: () => void
  onCreated?: (task: Task) => void
  onBlurOutside?: () => void
  className?: string
}

function endOfDayIso(date: Date): string {
  const value = new Date(date.getTime())
  value.setHours(23, 59, 59, 0)
  return value.toISOString()
}

function shortDate(value: string): string {
  if (!value || value === NULL_DATE) return 'Date'
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ActionButton({ active, label, children, onClick }: {
  active?: boolean
  label: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors hover:bg-[var(--bg-hover)]',
        active ? 'bg-[var(--bg-selected)] text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]',
      )}
      title={label}
    >
      {children}
    </button>
  )
}

export function NewTaskComposer({
  projectId,
  defaultDueDate,
  inputRef,
  onCancel,
  onCreated,
  onBlurOutside,
  className,
}: NewTaskComposerProps) {
  const parser = useTaskParser()
  const { data: labels = [] } = useLabels()
  const { data: projects } = useProjects()
  const createTask = useCreateTask()
  const addLabel = useAddLabel()
  const createLabel = useCreateLabel()
  const uploadAttachment = useUploadAttachmentFromPaste()
  const updateTask = useUpdateTask()
  const [description, setDescription] = useState('')
  const [showNotes, setShowNotes] = useState(false)
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null)
  const [explicitDueDate, setExplicitDueDate] = useState<string | null>(null)
  const [dateTouched, setDateTouched] = useState(false)
  const [defaultDateDismissed, setDefaultDateDismissed] = useState(false)
  const [priority, setPriority] = useState<number | null>(null)
  const [repeatAfter, setRepeatAfter] = useState(0)
  const [repeatMode, setRepeatMode] = useState(0)
  const [recurrenceTouched, setRecurrenceTouched] = useState(false)
  const [reminders, setReminders] = useState<TaskReminder[]>([])
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState(projectId)
  const [projectTouched, setProjectTouched] = useState(false)
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const attachmentsRef = useRef<DraftAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partialFailure, setPartialFailure] = useState<PartialFailure | null>(null)

  const projectItems = useMemo(() => (projects?.flat ?? []).map((project) => ({ id: project.id, title: project.title })), [projects])
  const labelItems = useMemo(() => labels.map((label) => ({ id: label.id, title: label.title })), [labels])
  const effectiveDueDate = dateTouched
    ? (explicitDueDate ?? NULL_DATE)
    : (!defaultDateDismissed && defaultDueDate ? endOfDayIso(defaultDueDate) : NULL_DATE)
  const selectedProjectTitle = projects?.flat.find((project) => project.id === selectedProjectId)?.title ?? 'Project'
  const priorityLabel = priority === null ? 'Priority' : PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? 'Priority'

  useEffect(() => {
    if (!projectTouched) setSelectedProjectId(projectId)
  }, [projectId, projectTouched])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => {
      if (attachment.blobUrl) URL.revokeObjectURL(attachment.blobUrl)
    })
  }, [])

  const contextChips = useMemo<ChipData[]>(() => {
    if (!defaultDueDate || defaultDateDismissed || dateTouched || parser.parseResult?.dueDate) return []
    return [{ type: 'date', label: shortDate(endOfDayIso(defaultDueDate)), key: 'context-date' }]
  }, [defaultDueDate, defaultDateDismissed, dateTouched, parser.parseResult?.dueDate])

  const closeAndReset = () => {
    attachments.forEach((attachment) => { if (attachment.blobUrl) URL.revokeObjectURL(attachment.blobUrl) })
    parser.reset()
    setDescription('')
    setShowNotes(false)
    setOpenPicker(null)
    setExplicitDueDate(null)
    setDateTouched(false)
    setDefaultDateDismissed(false)
    setPriority(null)
    setRepeatAfter(0)
    setRepeatMode(0)
    setRecurrenceTouched(false)
    setReminders([])
    setSelectedLabelIds([])
    setSelectedProjectId(projectId)
    setProjectTouched(false)
    setAttachments([])
    setError(null)
  }

  const resolveLabels = async (names: string[]): Promise<Label[]> => {
    const resolved: Label[] = []
    for (const name of names) {
      const existing = labels.find((label) => label.title.toLowerCase() === name.toLowerCase())
      resolved.push(existing ?? await createLabel.mutateAsync({ title: name }))
    }
    return resolved
  }

  const uploadDrafts = async (taskId: number, drafts: DraftAttachment[], currentDescription: string) => {
    const failed: DraftAttachment[] = []
    const mapping: Record<string, number> = {}
    let descriptionPatch: string | undefined
    for (const draft of drafts) {
      try {
        const result = await uploadAttachment.mutateAsync({
          taskId,
          fileData: draft.bytes,
          fileName: draft.name,
          mimeType: draft.mime,
        })
        if (draft.pendingToken) mapping[draft.pendingToken] = result.attachmentId
        if (draft.blobUrl) URL.revokeObjectURL(draft.blobUrl)
      } catch {
        failed.push(draft)
      }
    }
    if (Object.keys(mapping).length) {
      const patched = replacePendingTokens(currentDescription, mapping)
      if (patched !== currentDescription) {
        try {
          await updateTask.mutateAsync({ id: taskId, task: { description: patched } })
          currentDescription = patched
        } catch {
          // The files already exist remotely, so retain only the description patch for
          // retry instead of re-uploading them and creating duplicate attachments.
          descriptionPatch = patched
        }
      }
    }
    return { failed, description: currentDescription, descriptionPatch }
  }

  const retryPartial = async () => {
    if (!partialFailure || submitting) return
    setSubmitting(true)
    setError(null)
    const failedLabels: PartialFailure['labels'] = []
    const taskResult = await api.fetchTaskById(partialFailure.taskId)
    let currentDescription = taskResult.success ? taskResult.data.description : ''
    let descriptionPatch = partialFailure.descriptionPatch
    if (descriptionPatch) {
      try {
        await updateTask.mutateAsync({ id: partialFailure.taskId, task: { description: descriptionPatch } })
        currentDescription = descriptionPatch
        descriptionPatch = undefined
      } catch {
        // Failed attachment markup remains staged and can be retried independently.
      }
    }
    for (const label of partialFailure.labels) {
      try {
        const id = label.id ?? (await resolveLabels([label.name]))[0].id
        await addLabel.mutateAsync({ taskId: partialFailure.taskId, labelId: id })
      } catch { failedLabels.push(label) }
    }
    const uploadResult = await uploadDrafts(
      partialFailure.taskId,
      partialFailure.attachments,
      descriptionPatch ?? currentDescription,
    )
    descriptionPatch = uploadResult.descriptionPatch ?? descriptionPatch
    const next: PartialFailure = {
      taskId: partialFailure.taskId,
      labels: failedLabels,
      attachments: uploadResult.failed,
      ...(descriptionPatch ? { descriptionPatch } : {}),
    }
    setAttachments(uploadResult.failed)
    const stillPartial = next.labels.length > 0 || next.attachments.length > 0 || !!next.descriptionPatch
    setPartialFailure(stillPartial ? next : null)
    if (stillPartial) setError('Some task details still could not be saved.')
    setSubmitting(false)
  }

  const submit = async () => {
    if (submitting || partialFailure) return
    let rawTitle = parser.inputValue.trim()
    if (!rawTitle) {
      closeAndReset()
      onCancel()
      return
    }
    setSubmitting(true)
    setError(null)
    let createdTask: Task | null = null
    try {
      const parsed = parser.parserConfig.enabled ? parser.parseResult : null
      const title = parsed?.title.trim() || rawTitle.replace(!parser.enabled && parser.parserConfig.bangToday ? /!/g : /$^/, '').trim()
      if (!title) throw new Error('Enter a task title')

      let targetProjectId = selectedProjectId
      if (!projectTouched && parsed?.project) {
        targetProjectId = projects?.flat.find((project) => project.title.toLowerCase() === parsed.project?.toLowerCase())?.id ?? targetProjectId
      }
      const payload: CreateTaskPayload = { title }
      const draftDescription = description.trim()
      if (draftDescription) payload.description = draftDescription
      const parsedDate = parsed?.dueDate ? endOfDayIso(parsed.dueDate) : undefined
      const legacyBangDate = !parser.enabled && parser.parserConfig.bangToday && rawTitle.includes('!') ? endOfDayIso(new Date()) : undefined
      const dueDate = dateTouched ? explicitDueDate : (parsedDate ?? legacyBangDate ?? (!defaultDateDismissed && defaultDueDate ? endOfDayIso(defaultDueDate) : undefined))
      if (dueDate && dueDate !== NULL_DATE) payload.due_date = dueDate
      const selectedPriority = priority !== null ? priority : parsed?.priority
      if (selectedPriority && selectedPriority > 0) payload.priority = selectedPriority
      if (reminders.length) payload.reminders = reminders
      if (recurrenceTouched) {
        payload.repeat_after = repeatAfter
        payload.repeat_mode = repeatMode
      } else if (parsed?.recurrence) {
        Object.assign(payload, recurrenceToVikunja(parsed.recurrence))
      }

      const task = await createTask.mutateAsync({ projectId: targetProjectId, task: payload })
      createdTask = task
      const labelNames = [...new Set(parsed?.labels ?? [])]
      const explicitLabels = labels.filter((label) => selectedLabelIds.includes(label.id))
      const failedLabels: PartialFailure['labels'] = []
      for (const label of explicitLabels) {
        try { await addLabel.mutateAsync({ taskId: task.id, labelId: label.id }) }
        catch { failedLabels.push({ id: label.id, name: label.title }) }
      }
      for (const name of labelNames.filter((entry) => !explicitLabels.some((label) => label.title.toLowerCase() === entry.toLowerCase()))) {
        let resolvedLabel: Label | undefined
        try {
          resolvedLabel = (await resolveLabels([name]))[0]
          await addLabel.mutateAsync({ taskId: task.id, labelId: resolvedLabel.id })
        } catch { failedLabels.push({ id: resolvedLabel?.id, name }) }
      }
      const uploaded = await uploadDrafts(task.id, attachments, draftDescription)
      const failure: PartialFailure = {
        taskId: task.id,
        labels: failedLabels,
        attachments: uploaded.failed,
        ...(uploaded.descriptionPatch ? { descriptionPatch: uploaded.descriptionPatch } : {}),
      }
      closeAndReset()
      onCreated?.(task)
      if (failure.labels.length || failure.attachments.length || failure.descriptionPatch) {
        setAttachments(failure.attachments)
        setPartialFailure(failure)
        setError('Task created, but some labels or attachments failed. Retry will not create another task.')
      }
    } catch (cause) {
      if (createdTask) {
        const failure = { taskId: createdTask.id, labels: [] as PartialFailure['labels'], attachments: [...attachments] }
        closeAndReset()
        setAttachments(failure.attachments)
        setPartialFailure(failure)
        setError('Task created, but some details failed. Retry will not create another task.')
        onCreated?.(createdTask)
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not create task')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const stagePendingImage = (image: PendingImage) => {
    setAttachments((current) => [...current, {
      id: image.uuid,
      name: image.name,
      mime: image.mime,
      bytes: image.bytes,
      pendingToken: image.uuid,
      blobUrl: image.blobUrl,
    }])
  }

  const stageFiles = async (files: FileList | null) => {
    if (!files) return
    const drafts = await Promise.all([...files].map(async (file): Promise<DraftAttachment> => ({
      id: crypto.randomUUID(),
      name: file.name,
      mime: file.type || 'application/octet-stream',
      bytes: new Uint8Array(await file.arrayBuffer()),
    })))
    setAttachments((current) => [...current, ...drafts])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id)
      if (removed?.blobUrl) URL.revokeObjectURL(removed.blobUrl)
      return current.filter((attachment) => attachment.id !== id)
    })
  }

  return (
    <div
      className={cn('border-b border-[var(--border-color)]', className)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        void submit()
        onBlurOutside?.()
      }}
    >
      <div className="flex items-start gap-3 px-4 py-2.5">
        <div className="mt-[7px] h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
        <TaskInputParser
          value={parser.inputValue}
          onChange={parser.setInputValue}
          onSubmit={() => { void submit() }}
          onCancel={() => { closeAndReset(); onCancel() }}
          onTab={() => setShowNotes(true)}
          parseResult={parser.parseResult}
          parserConfig={parser.parserConfig}
          onSuppressType={parser.suppressType}
          prefixes={parser.prefixes}
          enabled={parser.enabled}
          projects={projectItems}
          labels={labelItems}
          inputRef={inputRef}
          placeholder="New Task"
          showBangTodayHint={!parser.enabled && !!parser.parserConfig.bangToday}
          className="min-w-0 flex-1"
          contextChips={contextChips}
          onDismissContextChip={() => setDefaultDateDismissed(true)}
        />
        <button type="button" onClick={() => { void submit() }} disabled={submitting || !parser.inputValue.trim()} className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent-blue)] text-white disabled:opacity-40" aria-label="Create task">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>

      {showNotes && (
        <div className="pb-2 pl-[46px] pr-4">
          <TaskDescription
            value={description}
            onChange={setDescription}
            onStagePending={stagePendingImage}
            onRemovePending={removeAttachment}
            pendingImages={Object.fromEntries(attachments.filter((attachment) => attachment.pendingToken && attachment.blobUrl).map((attachment) => [attachment.id, {
              uuid: attachment.id,
              name: attachment.name,
              mime: attachment.mime,
              bytes: attachment.bytes,
              blobUrl: attachment.blobUrl!,
            }]))}
            placeholder="Notes"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Escape') (inputRef as React.RefObject<HTMLInputElement> | undefined)?.current?.focus()
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit() }
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-0.5 pb-2 pl-[46px] pr-4">
        <div className="relative">
          <ActionButton active={effectiveDueDate !== NULL_DATE || repeatAfter > 0} label="Date and repeat" onClick={() => setOpenPicker(openPicker === 'date' ? null : 'date')}>
            <CalendarDays className="h-3.5 w-3.5" /> {shortDate(effectiveDueDate)}
          </ActionButton>
          {openPicker === 'date' && <DatePickerPopover currentDate={effectiveDueDate} onDateChange={(value) => { setDateTouched(true); setExplicitDueDate(value) }} repeatAfter={repeatAfter} repeatMode={repeatMode} onRecurrenceChange={(after, mode) => { setRecurrenceTouched(true); setRepeatAfter(after); setRepeatMode(mode) }} onClose={() => setOpenPicker(null)} />}
        </div>
        <div className="relative">
          <ActionButton active={reminders.length > 0} label="Reminder" onClick={() => setOpenPicker(openPicker === 'reminder' ? null : 'reminder')}>
            <Bell className="h-3.5 w-3.5" /> {reminders.length ? `${reminders.length} reminder${reminders.length === 1 ? '' : 's'}` : 'Reminder'}
          </ActionButton>
          {openPicker === 'reminder' && <ReminderPickerPopover dueDate={effectiveDueDate} reminders={reminders} onReminderChange={setReminders} onClose={() => setOpenPicker(null)} />}
        </div>
        <div className="relative">
          <ActionButton active={priority !== null && priority > 0} label="Priority" onClick={() => setOpenPicker(openPicker === 'priority' ? null : 'priority')}>
            <Flag className="h-3.5 w-3.5" /> {priorityLabel}
          </ActionButton>
          {openPicker === 'priority' && <PriorityPickerPopover currentPriority={priority ?? 0} onPriorityChange={setPriority} onClose={() => setOpenPicker(null)} />}
        </div>
        <div className="relative">
          <ActionButton active={selectedLabelIds.length > 0} label="Labels" onClick={() => setOpenPicker(openPicker === 'labels' ? null : 'labels')}>
            <Tags className="h-3.5 w-3.5" /> {selectedLabelIds.length ? `${selectedLabelIds.length} label${selectedLabelIds.length === 1 ? '' : 's'}` : 'Labels'}
          </ActionButton>
          {openPicker === 'labels' && <DraftLabelPickerPopover selectedIds={selectedLabelIds} onChange={setSelectedLabelIds} onClose={() => setOpenPicker(null)} />}
        </div>
        <div className="relative">
          <ActionButton active={projectTouched} label="Project" onClick={() => setOpenPicker(openPicker === 'project' ? null : 'project')}>
            <FolderOpen className="h-3.5 w-3.5" /> <span className="max-w-28 truncate">{selectedProjectTitle}</span>
          </ActionButton>
          {openPicker === 'project' && <ProjectPickerPopover currentProjectId={selectedProjectId} onSelect={(id) => { setSelectedProjectId(id); setProjectTouched(true) }} onClose={() => setOpenPicker(null)} />}
        </div>
        <ActionButton active={showNotes || !!description} label="Notes" onClick={() => setShowNotes((value) => !value)}>
          <AlignLeft className="h-3.5 w-3.5" /> Notes
        </ActionButton>
        <ActionButton active={attachments.length > 0} label="Attachments" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-3.5 w-3.5" /> {attachments.length ? `${attachments.length} file${attachments.length === 1 ? '' : 's'}` : 'Attach'}
        </ActionButton>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => { void stageFiles(event.target.files) }} />
      </div>

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-2 pl-[46px] pr-4">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="flex max-w-48 items-center gap-1 rounded bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
              <span className="truncate">{attachment.name}</span>
              <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      {(error || partialFailure) && (
        <div className="flex items-center justify-between gap-2 px-4 pb-2 pl-[46px] text-[11px] text-accent-red">
          <span>{error}</span>
          {partialFailure && <button type="button" onClick={() => { void retryPartial() }} disabled={submitting} className="rounded border border-current px-2 py-1 font-medium">Retry</button>}
        </div>
      )}
    </div>
  )
}
