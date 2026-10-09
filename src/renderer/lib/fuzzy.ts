// Fuzzy matching for the command palette: the letters of the query must appear in order in the
// text, and a match scores higher when it is a whole word or the start of one, runs together, or
// starts the text. Pure, no DOM.

const WORD_START = /[\s\-_/.:,()[\]]/

/** Score of one search term in `text` (both lower case), or null when its letters are not all there in order. */
function scoreTerm(term: string, text: string): number | null {
  if (term === '') return 0
  // A plain substring is the best kind of match: whole word and prefix are worth more.
  const at = text.indexOf(term)
  if (at !== -1) {
    let score = 100 + term.length * 4
    if (at === 0) score += 60
    else if (WORD_START.test(text[at - 1])) score += 40
    const end = at + term.length
    if (end === text.length || WORD_START.test(text[end])) score += 20
    return score - Math.min(at, 30)
  }

  // Otherwise a subsequence: each letter after the previous one, preferring word starts and runs.
  let score = 0
  let from = 0
  let previous = -2
  for (const char of term) {
    const index = text.indexOf(char, from)
    if (index === -1) return null
    score += 10
    if (index === previous + 1) score += 12
    if (index === 0 || WORD_START.test(text[index - 1])) score += 8
    score -= Math.min(index - from, 6)
    previous = index
    from = index + 1
  }
  return score
}

/**
 * How well `query` matches `text`: higher is better, null means no match. Several words in the
 * query are matched one by one and all of them must match. An empty query matches with 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return 0
  const haystack = text.toLowerCase()
  let total = 0
  for (const term of terms) {
    const score = scoreTerm(term, haystack)
    if (score === null) return null
    total += score
  }
  // Shorter text wins a tie: "Logbook" before "Logbook of the long project".
  return total - Math.min(haystack.length, 60) / 10
}

export interface Ranked<T> {
  item: T
  score: number
}

/** The items that match, best first; equal scores keep their order. */
export function fuzzyRank<T>(items: readonly T[], query: string, text: (item: T) => string, limit = Infinity): Ranked<T>[] {
  const ranked: (Ranked<T> & { order: number })[] = []
  items.forEach((item, order) => {
    const score = fuzzyScore(query, text(item))
    if (score !== null) ranked.push({ item, score, order })
  })
  ranked.sort((a, b) => b.score - a.score || a.order - b.order)
  return ranked.slice(0, limit).map(({ item, score }) => ({ item, score }))
}
