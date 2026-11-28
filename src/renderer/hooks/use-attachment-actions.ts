import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { clipboardImageBytes } from '@/lib/copy-image'
import { attachmentBytesQuery } from './use-attachment-bytes'

export interface AttachmentNotice {
  text: string
  error: boolean
}

/**
 * Open (in the default app), Save (to a place the user picks) and, for an image, Copy (onto the
 * clipboard) for one task's attachments, shared by the attachment list and the image viewer.
 * `notice` says what the last one did; `savingId` is the attachment being saved.
 */
export function useAttachmentActions(taskId: number) {
  const [notice, setNotice] = useState<AttachmentNotice | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  const open = useCallback(
    async (attachmentId: number, fileName: string) => {
      setNotice(null)
      const result = await api.openTaskAttachment(taskId, attachmentId, fileName)
      if (!result.success) setNotice({ text: `Could not open ${fileName}: ${result.error}`, error: true })
    },
    [taskId],
  )

  const save = useCallback(
    async (attachmentId: number, fileName: string) => {
      setNotice(null)
      setSavingId(attachmentId)
      try {
        const result = await api.saveTaskAttachment(taskId, attachmentId, fileName)
        if (!result.success) {
          setNotice({ text: `Could not save ${fileName}: ${result.error}`, error: true })
        } else if (result.data.saved) {
          const where = result.data.path?.split(/[\\/]/).slice(-2, -1)[0]
          setNotice({ text: where ? `Saved to ${where}` : 'Saved', error: false })
        }
      } finally {
        setSavingId(null)
      }
    },
    [taskId],
  )

  const queryClient = useQueryClient()
  // The original file, from the viewer's cache when it has it (no second download).
  const copyImage = useCallback(
    async (attachmentId: number, fileName: string, mime: string) => {
      setNotice(null)
      try {
        const original = await queryClient.fetchQuery(attachmentBytesQuery(taskId, attachmentId, 'original'))
        const result = await api.writeClipboardImage(await clipboardImageBytes(original, mime))
        if (!result.success) throw new Error(result.error)
        setNotice({ text: 'Image copied', error: false })
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error'
        setNotice({ text: `Could not copy ${fileName}: ${reason}`, error: true })
      }
    },
    [taskId, queryClient],
  )

  const clearNotice = useCallback(() => setNotice(null), [])

  return { notice, clearNotice, savingId, open, save, copyImage }
}
