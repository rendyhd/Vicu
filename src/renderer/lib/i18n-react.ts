import { setI18n } from 'react-i18next'
import { i18n } from '../../shared/i18n'

// Gives react-i18next the app's i18next instance, so `useTranslation()` and `<Trans>` work in any
// React tree without a provider. Imported once by the main window's entry (main.tsx); Quick Entry
// and Quick View have no React and use `t` from src/shared/i18n directly.
setI18n(i18n)
