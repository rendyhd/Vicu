import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const user = await api.getUser()
      if (!user) throw new Error('User not available')
      return user
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}
