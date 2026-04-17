import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: 'var(--bg-sidebar)',
        },
        accent: {
          blue: 'var(--accent-blue)',
          red: 'var(--accent-red)',
          orange: 'var(--accent-orange)',
          yellow: 'var(--accent-yellow)',
          green: 'var(--accent-green)',
        },
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
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
