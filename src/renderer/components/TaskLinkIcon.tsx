import { extractTaskLink } from '@/lib/note-link'

interface Props {
  description: string | undefined | null
}

export function TaskLinkIcon({ description }: Props) {
  const link = extractTaskLink(description)
  if (!link) return null

  if (link.kind === 'note') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); window.api.openDeepLink(link.url) }}
        title={`Open "${link.name}" in Obsidian`}
        className="ml-1 inline-flex items-center rounded p-0.5 text-purple-500 opacity-50 transition-opacity hover:bg-purple-500/10 hover:opacity-100 dark:text-purple-400"
      >
        <svg width="12" height="12" viewBox="0 0 100 100" className="flex-shrink-0">
          <path d="M68.6 2.2 32.8 19.8a4 4 0 0 0-2.2 2.7L18.2 80.1a4 4 0 0 0 1 3.7l16.7 16a4 4 0 0 0 3.6 1.1l42-9.6a4 4 0 0 0 2.8-2.3L97.7 46a4 4 0 0 0-.5-3.8L72.3 3a4 4 0 0 0-3.7-1.8z" fill="currentColor"/>
        </svg>
      </button>
    )
  }

  // Page link (browser)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); window.api.openDeepLink(link.url) }}
      title={`Open "${link.title}"`}
      className="ml-1 inline-flex items-center rounded p-0.5 text-blue-500 opacity-50 transition-opacity hover:bg-blue-500/10 hover:opacity-100 dark:text-blue-400"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>
    </button>
  )
}
