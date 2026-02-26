import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { getParserConfig } from '@/lib/task-parser'
import type { ParserConfig } from '@/lib/task-parser'
import { DEFAULT_PARSER_CONFIG } from '@/lib/task-parser'

/**
 * Reactive parser config hook.
 *
 * Fetches config on mount and re-fetches whenever the window regains focus
 * (e.g. user returns from Settings view). This ensures config changes
 * (syntax mode toggle, NLP enable/disable) propagate without requiring
 * a full page reload.
 */
export function useParserConfig(): ParserConfig {
  const [config, setConfig] = useState<ParserConfig>(DEFAULT_PARSER_CONFIG)

  const refresh = useCallback(() => {
    api.getConfig().then((appConfig) => {
      if (appConfig) {
        setConfig(getParserConfig(appConfig))
      }
    })
  }, [])

  useEffect(() => {
    refresh()

    const handleFocus = () => refresh()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])

  return config
}
