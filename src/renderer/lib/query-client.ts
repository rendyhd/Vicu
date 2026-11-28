import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from '@/stores/toast-store'
import { toastForMutationError, type ErrorToast, type MutationMeta } from './mutation-errors'

/**
 * The app's query client. Every failed mutation lands in `MutationCache.onError`, which shows a
 * toast with a readable reason unless the mutation opted out with `meta: { silent: true }` because
 * it shows its own error (D-REN-3). A change that went into the offline queue does not fail, so it
 * does not toast here; the sync indicator shows it instead.
 *
 * Network mode is `always`: nothing here talks to the network itself. Every request goes to the
 * host (main, or the web host in a tab), which says whether a failure was the network and whether
 * the change goes into the offline queue. With the library's default (`online`) a query or a
 * mutation is held back, not started, once the window has had an `offline` event, so a task made
 * after Wi-Fi dropped waited with a spinner until the connection came back and never reached the
 * queue (rendyhd/Vicu#77). Started without a connection the app never gets that event, which is
 * why it only happened when the connection was lost later. The same went for a server on this
 * computer or the local network, which needs no internet at all. `refetchOnReconnect` is set
 * because its default is off under `always`.
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
        networkMode: 'always',
        refetchOnReconnect: true,
      },
      mutations: {
        networkMode: 'always',
      },
    },
  })
}

export const queryClient = createAppQueryClient((failure) => toast.error(failure.message))
