import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'
import { loadTokens, tailwindTheme } from './scripts/gen-tokens.mjs'

// Colours, type sizes and radii come from the design token contract
// (test-fixtures/design-tokens-v1.json) through scripts/gen-tokens.mjs, the same module that
// writes src/renderer/assets/tokens.css. Colours are rgb(var(--x-rgb) / <alpha-value>), so
// opacity classes such as bg-accent-blue/15 work; bg-sidebar stays a raw var() (no opacity).
const tokenTheme = tailwindTheme(loadTokens())

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: tokenTheme.colors,
      // Motion roles (test-fixtures/design-tokens-v1.json, "motion"). The variables are in tokens.css, so
      // components write duration-fade-base or ease-standard instead of a millisecond value.
      transitionDuration: {
        // A bare `transition` or `transition-colors` takes the fast fade, not Tailwind's own 150 ms.
        DEFAULT: 'var(--dur-fade-fast)',
        'fade-fast': 'var(--dur-fade-fast)',
        'fade-base': 'var(--dur-fade-base)',
        move: 'var(--dur-move)',
        'move-expressive': 'var(--dur-move-expressive)',
        pop: 'var(--dur-pop)',
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--ease-standard)',
        standard: 'var(--ease-standard)',
        enter: 'var(--ease-enter)',
        exit: 'var(--ease-exit)',
      },
      // The reading column every view sits in (ContentArea.tsx).
      maxWidth: { reading: '760px' },
      fontSize: tokenTheme.fontSize,
      borderRadius: tokenTheme.borderRadius,
      opacity: tokenTheme.opacity,
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'var(--text-primary)',
            '--tw-prose-headings': 'var(--text-primary)',
            '--tw-prose-lead': 'var(--text-secondary)',
            '--tw-prose-links': 'var(--accent-blue)',
            '--tw-prose-bold': 'var(--text-primary)',
            '--tw-prose-counters': 'var(--text-secondary)',
            '--tw-prose-bullets': 'var(--text-secondary)',
            '--tw-prose-hr': 'var(--border-color)',
            '--tw-prose-quotes': 'var(--text-primary)',
            '--tw-prose-quote-borders': 'var(--border-color)',
            '--tw-prose-captions': 'var(--text-secondary)',
            '--tw-prose-code': 'var(--text-primary)',
            '--tw-prose-pre-code': 'var(--text-primary)',
            '--tw-prose-pre-bg': 'var(--bg-hover)',
            '--tw-prose-th-borders': 'var(--border-color)',
            '--tw-prose-td-borders': 'var(--border-color)',
            '--tw-prose-invert-body': 'var(--text-primary)',
            '--tw-prose-invert-headings': 'var(--text-primary)',
            '--tw-prose-invert-lead': 'var(--text-secondary)',
            '--tw-prose-invert-links': 'var(--accent-blue)',
            '--tw-prose-invert-bold': 'var(--text-primary)',
            '--tw-prose-invert-counters': 'var(--text-secondary)',
            '--tw-prose-invert-bullets': 'var(--text-secondary)',
            '--tw-prose-invert-hr': 'var(--border-color)',
            '--tw-prose-invert-quotes': 'var(--text-primary)',
            '--tw-prose-invert-quote-borders': 'var(--border-color)',
            '--tw-prose-invert-captions': 'var(--text-secondary)',
            '--tw-prose-invert-code': 'var(--text-primary)',
            '--tw-prose-invert-pre-code': 'var(--text-primary)',
            '--tw-prose-invert-pre-bg': 'var(--bg-hover)',
            '--tw-prose-invert-th-borders': 'var(--border-color)',
            '--tw-prose-invert-td-borders': 'var(--border-color)',
          },
        },
        sm: {
          css: {
            'p': { marginTop: '0', marginBottom: '0.5em' },
            'p:last-child': { marginBottom: '0' },
            'ul, ol': { marginTop: '0.25em', marginBottom: '0.5em' },
            'li': { marginTop: '0.125em', marginBottom: '0.125em' },
            'h1, h2, h3, h4': { marginTop: '0.75em', marginBottom: '0.25em' },
            'code': {
              backgroundColor: 'var(--bg-hover)',
              padding: '0.1em 0.3em',
              borderRadius: '3px',
              fontSize: '0.9em',
            },
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
            'pre': {
              padding: '0.5em 0.75em',
              borderRadius: '4px',
              fontSize: '0.85em',
            },
            'ul[data-type="taskList"]': {
              listStyle: 'none',
              paddingLeft: '0',
            },
            'ul[data-type="taskList"] li': {
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.4em',
            },
            'ul[data-type="taskList"] input[type="checkbox"]': {
              marginTop: '0.25em',
            },
          },
        },
      },
    },
  },
  plugins: [typography],
}

export default config
