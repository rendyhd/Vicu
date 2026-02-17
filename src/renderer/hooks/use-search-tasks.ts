import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Task } from '@/lib/vikunja-types'

/**
 * Score how well a task matches a search query.
 * Higher score = better match. Returns 0 for no match.
 */
function scoreTask(task: Task, terms: string[]): number {
  const title = task.title.toLowerCase()
  const desc = (task.description || '').toLowerCase()
  let score = 0

  for (const term of terms) {
    const titleIdx = title.indexOf(term)
    const descIdx = desc.indexOf(term)

    if (titleIdx === -1 && descIdx === -1) return 0 // all terms must match somewhere

    if (titleIdx !== -1) {
      score += 100
      // Bonus: match at start of title
      if (titleIdx === 0) score += 50
      // Bonus: match at word boundary
      if (titleIdx === 0 || title[titleIdx - 1] === ' ') score += 25
      // Bonus: exact full-word match
      const endIdx = titleIdx + term.length
      if ((titleIdx === 0 || title[titleIdx - 1] === ' ') &&
          (endIdx === title.length || title[endIdx] === ' ')) {
        score += 25
      }
    }

    if (descIdx !== -1) {
      score += 10
    }
  }

  return score
}

export function useSearchTasks(query: string) {
  return useQuery({
    queryKey: ['tasks', 'search', query],
    queryFn: async () => {
      // Fetch a large batch with the server-side search param as a pre-filter
      const result = await api.fetchTasks({
        s: query,
        per_page: 200,
      })
      if (!result.success) throw new Error(result.error)

      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      if (terms.length === 0) return result.data

      // Score and rank results client-side
      const scored = result.data
        .map((task) => ({ task, score: scoreTask(task, terms) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)

      return scored.map((r) => r.task)
    },
    enabled: !!query && query.length > 0,
  })
}
