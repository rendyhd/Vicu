import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const root = resolve(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8')

// Card 1.3 (D-1): every picker floats in the top layer through the one Popover primitive, so no
// card, list or content area can clip it. The scenario `popover-edge` (E4) checks the behaviour
// in the running app; this keeps a picker from going back to an absolutely positioned div.
const PICKERS = [
  'WhenPopover',
  'ReminderPickerPopover',
  'PriorityPickerPopover',
  'LabelPickerPopover',
  'DraftLabelPickerPopover',
  'ProjectPickerPopover',
  'RecurrencePickerPopover',
  'AttachmentPickerPopover',
  'InfoPopover',
]

describe('picker popovers', () => {
  it('has all nine pickers on the Popover primitive', () => {
    expect(PICKERS).toHaveLength(9)
    for (const name of PICKERS) {
      const source = read(`components/task-list/${name}.tsx`)
      expect(source, name).toContain("from '../overlay/Popover'")
      expect(source, name).toMatch(/<Popover[\s>]/)
      expect(source, name).toContain('anchorRef')
    }
  })

  it('does not position any picker by hand', () => {
    for (const name of PICKERS) {
      const source = read(`components/task-list/${name}.tsx`)
      expect(source, name).not.toMatch(/top-full/)
      expect(source, name).not.toMatch(/\babsolute\b/)
      expect(source, name).not.toContain('mousedown')
    }
  })

  it('no longer has the left/right alignment hook', () => {
    expect(existsSync(resolve(root, 'components/task-list/use-popover-alignment.ts'))).toBe(false)
    for (const name of PICKERS) {
      expect(read(`components/task-list/${name}.tsx`), name).not.toContain('use-popover-alignment')
    }
  })

  it('gives every anchor to its picker', () => {
    // The open card's property bar (card 3.3) holds the pickers' anchors.
    const row = read('components/task-list/TaskCardBar.tsx')
    for (const picker of ['WhenPopover', 'PriorityPickerPopover', 'LabelPickerPopover', 'ReminderPickerPopover', 'AttachmentPickerPopover', 'ProjectPickerPopover', 'RecurrencePickerPopover', 'InfoPopover']) {
      expect(row, picker).toMatch(new RegExp(`<${picker}\\s+anchorRef=`))
    }
    const composer = read('components/task-list/NewTaskComposer.tsx')
    for (const picker of ['WhenPopover', 'ReminderPickerPopover', 'PriorityPickerPopover', 'DraftLabelPickerPopover', 'ProjectPickerPopover']) {
      expect(composer, picker).toMatch(new RegExp(`<${picker} anchorRef=`))
    }
  })
})

describe('the Popover primitive', () => {
  const popover = read('components/overlay/Popover.tsx')
  const hook = read('components/overlay/use-floating-popover.ts')

  it('uses the native popover attribute and Floating UI with the fixed strategy', () => {
    expect(popover).toContain('popover="auto"')
    expect(hook).toContain("from '@floating-ui/dom'")
    expect(hook).toContain("strategy: 'fixed'")
    for (const middleware of ['offset(', 'flip(', 'shift(', 'size(', 'autoUpdate(']) {
      expect(hook).toContain(middleware)
    }
  })

  it('listens to the toggle events with addEventListener (React 18 does not know them)', () => {
    expect(popover).toContain("addEventListener('beforetoggle'")
    expect(popover).toContain("addEventListener('toggle'")
    expect(popover).not.toMatch(/\sonToggle=|\sonBeforeToggle=/)
  })
})
