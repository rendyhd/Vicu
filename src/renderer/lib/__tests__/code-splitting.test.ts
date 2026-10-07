import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '..', '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8')

// Static imports of these modules would pull them (and the TipTap editor, the sign-in screens and
// the 90 KB logo) back into the first chunk the app parses before it can paint (D-REN-5).
const staticImport = (source: string, specifier: string) =>
  new RegExp(`^import[^\n]*from\s+['"]${specifier.replace(/[.*+?^${}()|[\]\/]/g, '\$&')}['"]`, 'm').test(source)

describe('what the first chunk loads', () => {
  it('loads the rarely opened views through lazy routes', () => {
    const router = read('router.tsx')
    for (const view of ['SettingsView', 'ReviewView', 'RoutinesView']) {
      expect(staticImport(router, `@/views/${view}`)).toBe(false)
      expect(router).toContain(`import('@/views/${view}')`)
    }
  })

  it('loads the sign-in screens and the logo only when needed', () => {
    const shell = read('components/layout/AppShell.tsx')
    expect(staticImport(shell, '@/views/SetupView')).toBe(false)
    expect(staticImport(shell, '@/views/ReauthView')).toBe(false)
    expect(staticImport(shell, '@/assets/vicu-logo')).toBe(false)
  })

  it('loads the rich text editor as its own chunk', () => {
    for (const file of ['components/task-list/TaskRow.tsx', 'components/task-list/TaskDescription.tsx', 'main.tsx']) {
      expect(staticImport(read(file), '@/components/rich-text/RichTextEditor')).toBe(false)
      expect(staticImport(read(file), './components/rich-text/RichTextEditor')).toBe(false)
    }
    const lazy = read('components/rich-text/LazyRichTextEditor.tsx')
    expect(lazy).toContain("import('./RichTextEditor')")
    // The type-only import is erased at build time.
    expect(lazy).toMatch(/import type \{ RichTextEditor as RichTextEditorComponent \}/)
  })
})
