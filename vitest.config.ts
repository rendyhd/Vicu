import { resolve } from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    globals: false,
    // The guard tests scan every file under src/renderer; on a busy machine that passes 5 s.
    testTimeout: 30_000,
    exclude: [...configDefaults.exclude, '**/out/**', '**/.claude/**'],
  },
})
