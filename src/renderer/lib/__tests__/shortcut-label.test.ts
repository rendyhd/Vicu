import { describe, expect, it } from 'vitest'
import { shortcutLabel } from '../shortcut-label'

describe('shortcutLabel', () => {
  it('writes Mod as Ctrl on Windows and Linux', () => {
    expect(shortcutLabel('Mod+T', false)).toBe('Ctrl+T')
    expect(shortcutLabel('Mod+Shift+P', false)).toBe('Ctrl+Shift+P')
  })

  it('writes the macOS symbols without separators', () => {
    expect(shortcutLabel('Mod+T', true)).toBe('⌘T')
    expect(shortcutLabel('Mod+Shift+P', true)).toBe('⌘⇧P')
  })

  it('leaves a single key alone', () => {
    expect(shortcutLabel('!', false)).toBe('!')
    expect(shortcutLabel('Enter', true)).toBe('Enter')
  })
})
