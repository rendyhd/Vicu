import { useRef, useState, useCallback, useEffect } from 'react'
import type { ParseResult, ParserConfig, TokenType, SyntaxPrefixes } from '@/lib/task-parser'
import { NlpInputHighlight } from '@/components/task-list/NlpParsePreview'
import { TokenChip, buildChips } from './TokenChip'
import { AutocompleteDropdown } from './AutocompleteDropdown'
import type { AutocompleteHandle } from './AutocompleteDropdown'
import { cn } from '@/lib/cn'
import type { ChipData } from './TokenChip'

interface AutocompleteItem {
  id: number
  title: string
}

interface TaskInputParserProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  onTab?: () => void
  parseResult: ParseResult | null
  parserConfig: ParserConfig
  onSuppressType: (type: TokenType) => void
  prefixes: SyntaxPrefixes
  enabled: boolean
  projects: AutocompleteItem[]
  labels: AutocompleteItem[]
  inputRef?: React.Ref<HTMLInputElement>
  placeholder?: string
  onBlur?: (e: React.FocusEvent) => void
  showBangTodayHint?: boolean
  className?: string
  /** Extra chips injected by the parent (e.g. context-based "Today" default). */
  contextChips?: ChipData[]
  onDismissContextChip?: (key: string) => void
}

export function TaskInputParser({
  value,
  onChange,
  onSubmit,
  onCancel,
  onTab,
  parseResult,
  parserConfig,
  onSuppressType,
  prefixes,
  enabled,
  projects,
  labels,
  inputRef,
  placeholder,
  onBlur,
  showBangTodayHint,
  className,
  contextChips,
  onDismissContextChip,
}: TaskInputParserProps) {
  const autocompleteRef = useRef<AutocompleteHandle>(null)
  const internalInputRef = useRef<HTMLInputElement>(null)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [isComposing, setIsComposing] = useState(false)
  const pendingSubmitRef = useRef(false)
  const autocompleteSelectedRef = useRef(false)

  // When autocomplete accepts a selection on Enter, the onChange state update
  // is async in React — parseResult won't reflect the new value yet.
  // Defer submit until parseResult updates.
  useEffect(() => {
    if (pendingSubmitRef.current) {
      pendingSubmitRef.current = false
      onSubmit()
    }
  }, [parseResult, onSubmit])

  // Merge refs — expose internal ref to parent via inputRef prop
  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      ;(internalInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      if (typeof inputRef === 'function') {
        inputRef(el)
      } else if (inputRef && typeof inputRef === 'object') {
        ;(inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
      }
    },
    [inputRef],
  )

  const handleAutocompleteSelect = useCallback(
    (item: AutocompleteItem, triggerStart: number, prefix: string) => {
      const el = internalInputRef.current
      if (!el) return

      autocompleteSelectedRef.current = true

      // Find end of the current token
      let tokenEnd = value.indexOf(' ', triggerStart)
      if (tokenEnd === -1) tokenEnd = value.length

      const hasSpaces = item.title.includes(' ')
      const replacement = hasSpaces ? `${prefix}"${item.title}" ` : `${prefix}${item.title} `
      const newValue = value.substring(0, triggerStart) + replacement + value.substring(tokenEnd)
      const newCursorPos = triggerStart + replacement.length

      onChange(newValue)

      // Set cursor position after React re-render
      requestAnimationFrame(() => {
        el.setSelectionRange(newCursorPos, newCursorPos)
        setCursorPosition(newCursorPos)
        el.focus()
      })
    },
    [value, onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Reset the autocomplete selection flag before handling
      autocompleteSelectedRef.current = false

      // Let autocomplete consume first (Tab returns true, Enter returns false after selecting)
      if (autocompleteRef.current?.handleKeyDown(e)) return

      if (e.key === 'Tab' && onTab) {
        e.preventDefault()
        onTab()
        return
      }
      if (e.key === 'Enter') {
        if (isComposing) return
        if (autocompleteSelectedRef.current) {
          // Autocomplete accepted a selection on Enter — the onChange state update
          // is async, so defer submit until parseResult reflects the new value.
          pendingSubmitRef.current = true
        } else {
          onSubmit()
        }
        return
      }
      if (e.key === 'Escape') {
        onCancel()
        return
      }
    },
    [onSubmit, onCancel, onTab, isComposing],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
      setCursorPosition(e.target.selectionStart ?? e.target.value.length)
    },
    [onChange],
  )

  const handleSelect = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    setCursorPosition((e.target as HTMLInputElement).selectionStart ?? 0)
  }, [])

  const chips = parseResult ? buildChips(parseResult) : []
  const hasTokens = enabled && parseResult && parseResult.tokens.length > 0

  return (
    <div className={cn('relative', className)}>
      {/* Input wrapper with highlight overlay */}
      <div className="relative">
        {hasTokens && (
          <NlpInputHighlight value={value} tokens={parseResult.tokens} />
        )}
        <input
          ref={setRefs}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onBlur={onBlur}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => {
            setIsComposing(false)
            // Re-sync cursor after composition
            const el = internalInputRef.current
            if (el) setCursorPosition(el.selectionStart ?? 0)
          }}
          placeholder={placeholder}
          className="relative w-full bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
        />

        {/* Autocomplete dropdown */}
        {!isComposing && (
          <AutocompleteDropdown
            ref={autocompleteRef}
            inputValue={value}
            cursorPosition={cursorPosition}
            prefixes={prefixes}
            projects={projects}
            labels={labels}
            onSelect={handleAutocompleteSelect}
            enabled={enabled}
          />
        )}
      </div>

      {/* Legacy bang-today hint */}
      {showBangTodayHint && value.includes('!') && (
        <span className="absolute right-0 top-1/2 -translate-y-1/2 shrink-0 text-[11px] font-medium text-accent-blue">
          Today
        </span>
      )}

      {/* Dismissible parse chips + context chips */}
      {(chips.length > 0 || (contextChips && contextChips.length > 0)) && (
        <div className="flex flex-wrap gap-1.5 pb-1.5 pt-1">
          {chips.map((chip) => (
            <TokenChip
              key={chip.key}
              type={chip.type}
              label={chip.label}
              onDismiss={() => onSuppressType(chip.type)}
            />
          ))}
          {contextChips?.map((chip) => (
            <TokenChip
              key={chip.key}
              type={chip.type}
              label={chip.label}
              onDismiss={onDismissContextChip ? () => onDismissContextChip(chip.key) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
