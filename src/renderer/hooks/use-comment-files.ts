import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { readUploadAnswer } from '../../shared/attachment-upload'
import { api } from '@/lib/api'
import { fileToUint8Array } from '@/lib/clipboard-images'
import type { CommentFileList, FileToAttach } from '@/lib/comment-files'
import { apiError } from '@/lib/mutation-errors'
import type { TaskAttachment, TaskComment } from '@/lib/vikunja-types'
import { useCommentsPaneStore, type StagedFile } from '@/stores/comments-pane-store'
import { useDeleteAttachment, useTaskAttachments } from './use-task-mutations'

// A file in a comment is a task attachment the comment's HTML points at (cross-app semantics 9.5).

const NO_FILES: StagedFile[] = []
let nextKey = 1

function changeStaged(taskId: number, change: (files: StagedFile[]) => StagedFile[]) {
  useCommentsPaneStore.setState((state) => {
    const next = change(state.stagedFiles[taskId] ?? NO_FILES)
    const { [taskId]: _, ...rest } = state.stagedFiles
    return { stagedFiles: next.length > 0 ? { ...rest, [taskId]: next } : rest }
  })
}

function changePicking(taskId: number, by: number) {
  useCommentsPaneStore.setState((state) => ({ picking: { ...state.picking, [taskId]: (state.picking[taskId] ?? 0) + by } }))
}

function addToList(cached: TaskAttachment[] | undefined, files: readonly TaskAttachment[]): TaskAttachment[] | undefined {
  return cached && [...cached.filter((a) => !files.some((f) => f.id === a.id)), ...files]
}

/**
 * The files added to the comment being written on a task. They go to the task at once (which needs
 * a connection and a task the server knows) and stay with it while the app runs, also when the card
 * closes; the comment names them when it is sent, and that is queued offline like any other.
 */
export function useCommentFiles(taskId: number) {
  const qc = useQueryClient()
  const staged = useCommentsPaneStore((state) => state.stagedFiles[taskId] ?? NO_FILES)
  const picking = useCommentsPaneStore((state) => (state.picking[taskId] ?? 0) > 0)
  const [notice, setNotice] = useState<string | null>(null)
  const deleteFile = useDeleteAttachment()
  const listKey = useMemo(() => ['task-attachments', taskId] as const, [taskId])

  const canAttach = useCallback(() => {
    if (taskId > 0) {
      setNotice(null)
      return true
    }
    setNotice('This task has not reached the server yet. You can attach files once it has.')
    return false
  }, [taskId])

  const upload = useMutation({
    meta: { action: 'attach the file' },
    mutationFn: async ({ item, key }: { item: FileToAttach; key: number }) => {
      try {
        const result = await api.uploadTaskAttachment(taskId, await fileToUint8Array(item.file), item.name, item.mime)
        if (!result.success) throw apiError(result)
        const answer = readUploadAnswer<TaskAttachment>(result.data)
        const attachment = answer.attachments[0]
        if (!attachment) throw new Error(answer.error ?? 'The server did not say what it stored')
        // Taken out while it was on its way: nobody has seen it yet, so it does not stay on the task.
        const wanted = (useCommentsPaneStore.getState().stagedFiles[taskId] ?? NO_FILES).some((file) => file.key === key)
        if (!wanted) {
          await api.deleteTaskAttachment(taskId, attachment.id)
          return
        }
        changeStaged(taskId, (files) => files.map((file) => (file.key === key ? { ...file, name: attachment.file.name || file.name, attachment } : file)))
        qc.setQueryData<TaskAttachment[]>(listKey, (cached) => addToList(cached, [attachment]))
      } catch (error) {
        changeStaged(taskId, (files) => files.filter((file) => file.key !== key))
        throw error
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
  })

  /** Pasted or dropped files: a chip for each at once, which the upload fills in. */
  const add = useCallback(
    (items: readonly FileToAttach[]) => {
      if (items.length === 0 || !canAttach()) return
      for (const item of items) {
        const key = nextKey++
        changeStaged(taskId, (files) => [...files, { key, name: item.name, attachment: null }])
        upload.mutate({ item, key })
      }
    },
    [canAttach, taskId, upload],
  )

  const pick = useMutation({
    meta: { action: 'attach the file' },
    mutationFn: async () => {
      changePicking(taskId, 1)
      try {
        const result = await api.pickAndUploadAttachment(taskId)
        if (!result.success) throw apiError(result)
        const { attachments, error } = result.data
        changeStaged(taskId, (files) => [...files, ...attachments.map((attachment) => ({ key: nextKey++, name: attachment.file.name, attachment }))])
        if (attachments.length > 0) qc.setQueryData<TaskAttachment[]>(listKey, (cached) => addToList(cached, attachments))
        if (error) setNotice(`Some files could not be attached: ${error}`)
      } finally {
        changePicking(taskId, -1)
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
  })

  /** The system's file dialog; what was picked goes to the task before this comes back. */
  const browse = useCallback(() => {
    if (canAttach()) pick.mutate()
  }, [canAttach, pick])

  /** Takes a file out of the comment being written, and off the task: nobody has seen it yet. */
  const remove = useCallback(
    (key: number) => {
      const file = staged.find((item) => item.key === key)
      changeStaged(taskId, (files) => files.filter((item) => item.key !== key))
      if (file?.attachment) deleteFile.mutate({ taskId, attachmentId: file.attachment.id })
    },
    [deleteFile, staged, taskId],
  )

  const clear = useCallback(() => changeStaged(taskId, () => []), [taskId])

  return { staged, picking, notice, add, browse, remove, clear }
}

/**
 * The task's attachments for its thread: read once a comment points at a file, and again whenever
 * the thread changes, because a file missing from a list older than its comment is not gone. The
 * thread's own regular read does not count as a change, so a file that is gone stays said to be.
 */
export function useCommentFileList(taskId: number, comments: readonly TaskComment[]): CommentFileList {
  const anyFile = useMemo(() => comments.some((comment) => comment.comment.includes('/attachments/')), [comments])
  const enabled = taskId > 0 && anyFile
  const { data, refetch } = useTaskAttachments(taskId, enabled)
  const threadKey = `${comments.length}:${comments[0]?.id}:${comments[comments.length - 1]?.id}`
  const [readFor, setReadFor] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    // A new read, not one already under way: that list could be older than this thread.
    void refetch().then((result) => {
      if (live && result.isSuccess) setReadFor(threadKey)
    })
    return () => {
      live = false
    }
  }, [enabled, refetch, threadKey])

  return useMemo(
    () => ({ known: new Map((data ?? []).map((attachment) => [attachment.id, attachment])), read: readFor === threadKey }),
    [data, readFor, threadKey],
  )
}
