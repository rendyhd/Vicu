import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { getParserConfig } from '@/lib/task-parser'
import type { ParserConfig } from '@/lib/task-parser'
import { DEFAULT_PARSER_CONFIG } from '@/lib/task-parser'

export function useParserConfig(): ParserConfig {
  const [config, setConfig] = useState<ParserConfig>(DEFAULT_PARSER_CONFIG)

  useEffect(() => {
    api.getConfig().then((appConfig) => {
      if (appConfig) {
        setConfig(getParserConfig(appConfig))
      }
    })
  }, [])

  return config
}
