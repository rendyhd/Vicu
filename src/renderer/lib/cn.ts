import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The role class names from tailwind.config.ts (generated from test-fixtures/design-tokens-v1.json).
// tailwind-merge does not know them, so it would read text-caption as a text colour and drop it next
// to text-status-overdue, and would not know that rounded-control and rounded-card replace each
// other. cn.test.ts checks these lists against the token contract.
export const FONT_SIZE_ROLES = [
  'page-title',
  'section',
  'group',
  'task-title',
  'card-title',
  'meta',
  'chip',
  'caption',
] as const
export const RADIUS_ROLES = ['control', 'popover', 'card', 'chip'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZE_ROLES] }],
      rounded: [{ rounded: [...RADIUS_ROLES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
