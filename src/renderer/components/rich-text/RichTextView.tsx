import { useMemo } from 'react'
import { sanitizeTaskHtml } from '@/lib/sanitize-html'
import { cn } from '@/lib/cn'

interface RichTextViewProps {
  html: string | null | undefined
  className?: string
}

export function RichTextView({ html, className }: RichTextViewProps) {
  const safe = useMemo(() => sanitizeTaskHtml(html), [html])
  if (!safe) return null
  return (
    <div
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
