import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
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

  const url = useMemo(() => {
    if (!query.data) return null
    const blob = new Blob([query.data], { type: mime })
    return URL.createObjectURL(blob)
  }, [query.data, mime])

  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  return { url, isLoading: query.isLoading, error: query.error }
}
