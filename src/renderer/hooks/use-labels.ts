import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useLabels() {
  return useQuery({
    queryKey: ['labels'],
    queryFn: async () => {
      const result = await api.fetchLabels()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })
}
