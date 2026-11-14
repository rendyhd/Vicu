import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'

const PREVIEW_STALE_TIME = 5 * 60 * 1000
// An original can be a full-size phone photo: keep it only a little while after the viewer closes.
const ORIGINAL_GC_TIME = 60 * 1000

/** The query that holds an attachment's bytes, so another reader (Copy image) shares the cache. */
export function attachmentBytesQuery(taskId: number, attachmentId: number, size: 'preview' | 'original') {
  return {
    queryKey: size === 'preview'
      ? ['attachment-preview-bytes', taskId, attachmentId]
      : ['attachment-original-bytes', taskId, attachmentId],
    queryFn: async (): Promise<Uint8Array> => {
      const result = await api.fetchTaskAttachmentBytes(taskId, attachmentId, size)
      if (!result.success) throw new Error(result.error)
      if (result.data.byteLength === 0) throw new Error('Attachment preview was empty')
      return result.data
    },
    staleTime: PREVIEW_STALE_TIME,
    gcTime: size === 'preview' ? 1000 * 60 * 10 : ORIGINAL_GC_TIME,
  }
}

/**
 * Fetches the bytes for a task attachment and returns an object URL suitable for
 * <img src>. The URL is revoked when the component unmounts or the attachment
 * changes. Preview bytes are periodically revalidated so a transient bad
 * response cannot remain cached for the lifetime of a long-running app.
 *
 * `preview` is the server's bounded image preview (task-note thumbnails);
 * `original` is the file itself (the image viewer).
 */
export function useAttachmentBlobUrl(
  taskId: number | undefined,
  attachmentId: number | undefined,
  mime: string = 'application/octet-stream',
  size: 'preview' | 'original' = 'preview'
): { url: string | null; isLoading: boolean; error: unknown; retry: () => Promise<void> } {
  const enabled = taskId != null && attachmentId != null
  const query = useQuery<Uint8Array>({
    ...attachmentBytesQuery(taskId as number, attachmentId as number, size),
    enabled,
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
