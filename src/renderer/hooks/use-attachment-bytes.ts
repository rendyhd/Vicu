import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

/**
 * Fetches the bytes for a task attachment and returns an object URL suitable for
 * <img src>. The URL is revoked when the component unmounts or the attachment
 * changes. Bytes are cached across remounts via TanStack Query.
 */
export function useAttachmentBlobUrl(
  taskId: number | undefined,
  attachmentId: number | undefined,
  mime: string = 'application/octet-stream'
): { url: string | null; isLoading: boolean; error: unknown } {
  const enabled = taskId != null && attachmentId != null
  const query = useQuery<Uint8Array>({
    queryKey: ['attachment-bytes', taskId, attachmentId],
    queryFn: async () => {
      const result = await api.fetchTaskAttachmentBytes(taskId as number, attachmentId as number)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 10,
  })

  // Create + revoke the URL inside the same effect so strict-mode double-invoke
  // makes a fresh URL after the cleanup, instead of leaving the img pointing at
  // a revoked one.
  const [url, setUrl] = useState<string | null>(null)
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
  }, [query.data, mime])

  return { url, isLoading: query.isLoading, error: query.error }
}
