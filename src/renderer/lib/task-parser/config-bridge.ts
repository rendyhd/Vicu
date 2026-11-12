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
  /** Pro's switch: the Pro phrases (cross-app semantics 5.5) are read only while it is on. */
  pro_enabled?: boolean
}

/**
 * Convert AppConfig fields to ParserConfig.
 */
export function getParserConfig(appConfig: AppConfigLike): ParserConfig {
  return {
    enabled: appConfig.nlp_enabled !== false,
    syntaxMode: appConfig.nlp_syntax_mode === 'vikunja' ? 'vikunja' : DEFAULT_PARSER_CONFIG.syntaxMode,
    bangToday: appConfig.exclamation_today !== false,
    ...(appConfig.pro_enabled === true && !appConfig.standalone_mode ? { pro: true } : {}),
    // Local tasks only keep a due date, so `for 30m` must not take the time out of it.
    ...(appConfig.standalone_mode ? { suppressTypes: ['length' as const] } : {}),
  }
}
