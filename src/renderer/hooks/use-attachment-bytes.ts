import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

const PREVIEW_STALE_TIME = 5 * 60 * 1000

/**
 * Fetches the bytes for a task attachment and returns an object URL suitable for
 * <img src>. The URL is revoked when the component unmounts or the attachment
 * changes. Preview bytes are periodically revalidated so a transient bad
 * response cannot remain cached for the lifetime of a long-running app.
 */
export function useAttachmentBlobUrl(
  taskId: number | undefined,
  attachmentId: number | undefined,
  mime: string = 'application/octet-stream'
): { url: string | null; isLoading: boolean; error: unknown; retry: () => Promise<void> } {
  const enabled = taskId != null && attachmentId != null
  const query = useQuery<Uint8Array>({
    queryKey: ['attachment-preview-bytes', taskId, attachmentId],
    queryFn: async () => {
      const result = await api.fetchTaskAttachmentBytes(taskId as number, attachmentId as number)
      if (!result.success) throw new Error(result.error)
      if (result.data.byteLength === 0) throw new Error('Attachment preview was empty')
      return result.data
    },
    enabled,
    staleTime: PREVIEW_STALE_TIME,
    gcTime: 1000 * 60 * 10,
  })

  // Create + revoke the URL inside the same effect so strict-mode double-invoke
  // makes a fresh URL after the cleanup, instead of leaving the img pointing at
  // a revoked one.
  const [url, setUrl] = useState<string | null>(null)
  const [urlRevision, setUrlRevision] = useState(0)
  useEffect(() => {
    if (!query.data) {
      setUrl(null)
      return
    }
    const blob = new Blob([query.data as BlobPart], { type: mime })
    const created = URL.createObjectURL(blob)
    setUrl(created)
    return () => {
      URL.revokeObjectURL(created)
    }
  }, [query.data, mime, urlRevision])

  const refetch = query.refetch
  const retry = useCallback(async () => {
    // Always issue a fresh object URL, even if TanStack preserves the same
    // Uint8Array reference after a byte-for-byte identical response.
    setUrl(null)
    setUrlRevision((revision) => revision + 1)
    await refetch()
  }, [refetch])

  return { url, isLoading: query.isLoading || query.isFetching, error: query.error, retry }
}
