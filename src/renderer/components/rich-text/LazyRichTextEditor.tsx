import { Suspense, lazy, type ComponentProps } from 'react'
import type { RichTextEditor as RichTextEditorComponent } from './RichTextEditor'
import { RichTextView } from './RichTextView'

// TipTap and ProseMirror are about a third of the app's code and only matter once a task is opened
// for editing, so they load as their own chunk (and are preloaded when the app is idle, see
// `preloadRichTextEditor`) instead of being parsed before the first paint.
const RichTextEditorChunk = lazy(() =>
  import('./RichTextEditor').then((module) => ({ default: module.RichTextEditor }))
)

/** Start loading the editor chunk without showing anything. Safe to call more than once. */
export function preloadRichTextEditor(): void {
  void import('./RichTextEditor').catch(() => {})
}

export function LazyRichTextEditor(props: ComponentProps<typeof RichTextEditorComponent>) {
  return (
    <Suspense fallback={<RichTextView html={props.value} className={props.className} />}>
      <RichTextEditorChunk {...props} />
    </Suspense>
  )
}
