import type { ParserConfig } from './types'
import { DEFAULT_PARSER_CONFIG } from './types'

/**
 * Minimal AppConfig shape needed by the config bridge.
 * Avoids importing the full AppConfig type (which lives in main process / vikunja-types).
 */
interface AppConfigLike {
  nlp_enabled?: boolean
  nlp_syntax_mode?: 'todoist' | 'vikunja'
  exclamation_today?: boolean
  standalone_mode?: boolean
}

/**
 * Convert AppConfig fields to ParserConfig.
 */
export function getParserConfig(appConfig: AppConfigLike): ParserConfig {
  return {
    enabled: appConfig.nlp_enabled !== false,
    syntaxMode: appConfig.nlp_syntax_mode === 'vikunja' ? 'vikunja' : DEFAULT_PARSER_CONFIG.syntaxMode,
    bangToday: appConfig.exclamation_today !== false,
    // Local tasks only keep a due date, so `for 30m` must not take the time out of it.
    ...(appConfig.standalone_mode ? { suppressTypes: ['length' as const] } : {}),
  }
}
