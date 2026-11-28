import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { AppConfig } from '@/lib/vikunja-types'
import { useLanguageInfo } from '@/hooks/use-language'
import { SYSTEM_LANGUAGE, availableLanguages, languageName, normalizeLanguageSetting } from '../../../shared/i18n'

/** Where a translator starts: the guide in the repository. */
const TRANSLATING_GUIDE = 'https://github.com/rendyhd/Vicu/blob/main/docs/translating.md'

/**
 * The language Vicu shows (Settings, General): "System default" or one of the catalogs in
 * `locales/`, each under its own name so a reader finds theirs whatever is on screen. Per device.
 * The change shows at once in every window, the menus and the tray.
 */
export function LanguageSetting({
  config,
  onChange,
}: {
  config: AppConfig | null
  onChange: (patch: Partial<AppConfig>) => void
}) {
  const { t } = useTranslation()
  const { system } = useLanguageInfo()
  const chosen = normalizeLanguageSetting(config?.language)
  const languages = useMemo(
    () => availableLanguages()
      .map((tag) => ({ tag, name: languageName(tag) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )
  // A setting from a build that had a language this one lacks: shown as chosen, by its tag.
  const known = chosen === SYSTEM_LANGUAGE || languages.some((l) => l.tag === chosen)

  return (
    <div>
      <label className="flex items-center justify-between gap-4">
        <span className="text-sm text-text">{t('language.label')}</span>
        <select
          value={chosen}
          onChange={(e) => onChange({ language: e.target.value })}
          className="rounded-control border border-border bg-bg-page px-3 py-1.5 text-sm text-text"
        >
          <option value={SYSTEM_LANGUAGE}>{t('language.system', { language: languageName(system) })}</option>
          {!known && <option value={chosen}>{languageName(chosen)}</option>}
          {languages.map((language) => (
            // Each name is written in its own language, so the page's language does not apply to it.
            <option key={language.tag} value={language.tag} lang={language.tag}>{language.name}</option>
          ))}
        </select>
      </label>
      <p className="mt-1.5 text-xs text-text-secondary">
        <Trans
          i18nKey="language.note"
          components={{
            // Not named `link`: that is an HTML element without content, and the tag would lose its text.
            guide: <a href={TRANSLATING_GUIDE} target="_blank" rel="noreferrer" className="text-accent-blue underline" />,
          }}
        />
      </p>
    </div>
  )
}
