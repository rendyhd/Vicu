import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useParserConfig } from './use-parser-config'
import { parse, getPrefixes } from '@/lib/task-parser'
import type { ParseResult, ParserConfig, TokenType, SyntaxPrefixes } from '@/lib/task-parser'

export interface UseTaskParserReturn {
  inputValue: string
  setInputValue: (value: string) => void
  parseResult: ParseResult | null
  parserConfig: ParserConfig
  suppressType: (type: TokenType) => void
  reset: () => void
  enabled: boolean
  prefixes: SyntaxPrefixes
}

/**
 * Suppression entry: remembers the raw token texts at the time of dismissal
 * so we can lift the suppression when the user edits the token.
 */
type SuppressionMap = Map<TokenType, string[]>

export function useTaskParser(): UseTaskParserReturn {
  const parserConfig = useParserConfig()
  const [inputValue, setInputValueRaw] = useState('')
  const [suppressions, setSuppressions] = useState<SuppressionMap>(new Map())

  // Keep a ref to the latest parse result so suppressType can read it
  // without needing it in useCallback deps.
  const parseResultRef = useRef<ParseResult | null>(null)
  const inputValueRef = useRef('')

  // Clear suppressions when syntax mode or enabled state changes —
  // suppressions from one mode may not apply to another.
  const prevModeRef = useRef(parserConfig.syntaxMode)
  const prevEnabledRef = useRef(parserConfig.enabled)
  useEffect(() => {
    if (
      prevModeRef.current !== parserConfig.syntaxMode ||
      prevEnabledRef.current !== parserConfig.enabled
    ) {
      setSuppressions(new Map())
      prevModeRef.current = parserConfig.syntaxMode
      prevEnabledRef.current = parserConfig.enabled
    }
  }, [parserConfig.syntaxMode, parserConfig.enabled])

  // On input change, check if any suppressed token texts have been modified.
  // If the raw text of a suppressed type is no longer in the input, lift it.
  const setInputValue = useCallback((value: string) => {
    setInputValueRaw(value)
    inputValueRef.current = value
    setSuppressions((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next: SuppressionMap = new Map()
      for (const [type, rawTexts] of prev) {
        if (rawTexts.every((t) => value.includes(t))) {
          next.set(type, rawTexts)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  // Build suppressTypes array from the map keys
  const suppressTypes = useMemo<TokenType[]>(() => {
    return suppressions.size > 0 ? [...suppressions.keys()] : []
  }, [suppressions])

  const parseResult = useMemo(() => {
    if (!parserConfig.enabled || !inputValue.trim()) return null
    const config: ParserConfig = suppressTypes.length > 0
      ? { ...parserConfig, suppressTypes }
      : parserConfig
    return parse(inputValue, config)
  }, [inputValue, parserConfig, suppressTypes])

  // Keep ref in sync
  parseResultRef.current = parseResult
  inputValueRef.current = inputValue

  const suppressType = useCallback((type: TokenType) => {
    const result = parseResultRef.current
    const input = inputValueRef.current
    // Capture the raw text of all tokens of this type
    const rawTexts = result?.tokens
      .filter((t) => t.type === type)
      .map((t) => input.substring(t.start, t.end)) ?? []

    setSuppressions((prev) => {
      const next = new Map(prev)
      next.set(type, rawTexts)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setInputValueRaw('')
    inputValueRef.current = ''
    setSuppressions(new Map())
  }, [])

  const prefixes = useMemo(() => getPrefixes(parserConfig.syntaxMode), [parserConfig.syntaxMode])

  return {
    inputValue,
    setInputValue,
    parseResult,
    parserConfig,
    suppressType,
    reset,
    enabled: parserConfig.enabled,
    prefixes,
  }
}
