import { afterEach, describe, expect, it } from 'vitest'
import { currentInput, pageTransitionTypes, recordInput, trackInput } from '../navigation-motion'

afterEach(() => recordInput('keyboard'))

describe('pageTransitionTypes', () => {
  it('animates a pointer navigation to another page', () => {
    expect(pageTransitionTypes({ hasFrom: true, pathChanged: true }, 'pointer')).toEqual(['page'])
  })
  it('skips keyboard navigation, the first load and changes of the search string only', () => {
    expect(pageTransitionTypes({ hasFrom: true, pathChanged: true }, 'keyboard')).toBe(false)
    expect(pageTransitionTypes({ hasFrom: false, pathChanged: true }, 'pointer')).toBe(false)
    expect(pageTransitionTypes({ hasFrom: true, pathChanged: false }, 'pointer')).toBe(false)
  })
  it('follows the last input by default', () => {
    recordInput('pointer')
    expect(pageTransitionTypes({ hasFrom: true, pathChanged: true })).toEqual(['page'])
    recordInput('keyboard')
    expect(pageTransitionTypes({ hasFrom: true, pathChanged: true })).toBe(false)
  })
})

describe('trackInput', () => {
  it('records key and pointer presses until stopped', () => {
    const handlers = new Map<string, () => void>()
    const target = {
      addEventListener: ((type: string, fn: () => void) => void handlers.set(type, fn)) as Window['addEventListener'],
      removeEventListener: ((type: string) => void handlers.delete(type)) as Window['removeEventListener'],
    }
    const stop = trackInput(target)
    handlers.get('pointerdown')?.()
    expect(currentInput()).toBe('pointer')
    handlers.get('keydown')?.()
    expect(currentInput()).toBe('keyboard')
    stop()
    expect(handlers.size).toBe(0)
  })
})
