import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from '@/stores/toast-store'
import { toastForMutationError, type ErrorToast, type MutationMeta } from './mutation-errors'

/**
 * The app's query client. Every failed mutation lands in `MutationCache.onError`, which shows a
 * toast with a readable reason unless the mutation opted out with `meta: { silent: true }` because
 * it shows its own error (D-REN-3). A change that went into the offline queue does not fail, so it
 * does not toast here; the sync indicator shows it instead.
 */
export function createAppQueryClient(report: (toast: ErrorToast) => void): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const decision = toastForMutationError(error, mutation.meta as MutationMeta | undefined)
        if (decision) report(decision)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  })
}

export const queryClient = createAppQueryClient((failure) => toast.error(failure.message))
