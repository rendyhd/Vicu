import type { Config } from 'tailwindcss'

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
    },
  },
  plugins: [],
}

export default config
