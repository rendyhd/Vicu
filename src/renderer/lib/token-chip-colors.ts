import type { TokenType } from '@/lib/task-parser'

/**
 * The colours of the parse chips and the highlight behind a recognised word in the task input
 * (green date, red priority, orange label, blue project, purple recurrence), as roles of the design
 * tokens instead of raw values.
 *
 * - The fill is the role's channel variable at an alpha (Tailwind `bg-accent-green/12`), 12% in the
 *   light theme and 20% in the dark one, so it follows the theme and the token file.
 * - The text is the role mixed half and half with `text` (`color-mix` in sRGB over the channel
 *   variable), which keeps the hue and passes 4.5:1 on the fill over every surface in both themes
 *   (assets/__tests__/token-chip-contrast.test.ts asserts it). The palette colours alone do not
 *   pass text contrast (docs/design-system-v1.md section 1), so they are never the text.
 *
 * The class strings are written out in full so Tailwind finds them.
 */
export const TOKEN_CHIP_ROLE = {
  date: 'accent-green',
  priority: 'accent-red',
  label: 'accent-orange',
  project: 'accent-blue',
  recurrence: 'accent-purple',
} as const satisfies Record<TokenType, string>

export const TOKEN_CHIP_CLASSES: Record<Exclude<TokenType, 'priority'>, string> = {
  date: 'bg-accent-green/12 dark:bg-accent-green/20 text-[color:color-mix(in_srgb,rgb(var(--accent-green-rgb)),var(--text-primary))]',
  label: 'bg-accent-orange/12 dark:bg-accent-orange/20 text-[color:color-mix(in_srgb,rgb(var(--accent-orange-rgb)),var(--text-primary))]',
  project: 'bg-accent-blue/12 dark:bg-accent-blue/20 text-[color:color-mix(in_srgb,rgb(var(--accent-blue-rgb)),var(--text-primary))]',
  recurrence: 'bg-accent-purple/12 dark:bg-accent-purple/20 text-[color:color-mix(in_srgb,rgb(var(--accent-purple-rgb)),var(--text-primary))]',
}

/** The alpha of the fill, per theme. */
export const TOKEN_CHIP_ALPHA = { light: 0.12, dark: 0.2 } as const
/** The alpha of the highlight behind a word in the input (text is drawn by the input itself). */
export const TOKEN_HIGHLIGHT_ALPHA = { light: 0.15, dark: 0.25 } as const

/** The background of the highlight behind a recognised word. */
export function tokenHighlightBackground(type: TokenType, isDark: boolean): string {
  const alpha = isDark ? TOKEN_HIGHLIGHT_ALPHA.dark : TOKEN_HIGHLIGHT_ALPHA.light
  return `rgb(var(--${TOKEN_CHIP_ROLE[type]}-rgb) / ${alpha})`
}
