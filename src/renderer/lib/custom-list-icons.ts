import {
  Ban,
  Bookmark, Briefcase, Code2, Dumbbell, Flag, Folder, GraduationCap, Heart, Home, Lightbulb,
  ListFilter, Palette, PawPrint, ShoppingCart, Sparkles, Star, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { t, type TranslationKey } from '../../shared/i18n'

// The icons a custom list can have. The key is what syncs (`icon` in the custom-lists carrier) and
// the mobile app draws the same keys (IconRegistry.PRESET_ICONS), so a key is never renamed.

export interface CustomListIcon {
  key: string
  label: string
  icon: LucideIcon
}

// The label is read when it is shown (a getter), so it follows the language.
function icon(key: string, labelKey: TranslationKey, component: LucideIcon): CustomListIcon {
  return { key, get label() { return t(labelKey) }, icon: component }
}

export const DEFAULT_CUSTOM_LIST_ICON = 'filter_list'

export const CUSTOM_LIST_ICONS: readonly CustomListIcon[] = [
  icon('filter_list', 'customLists.icons.filter', ListFilter),
  icon('folder', 'customLists.icons.folder', Folder),
  icon('star', 'customLists.icons.star', Star),
  icon('favorite', 'customLists.icons.heart', Heart),
  icon('home', 'customLists.icons.home', Home),
  icon('work', 'customLists.icons.work', Briefcase),
  icon('school', 'customLists.icons.school', GraduationCap),
  icon('shopping_cart', 'customLists.icons.cart', ShoppingCart),
  icon('fitness', 'customLists.icons.fitness', Dumbbell),
  icon('code', 'customLists.icons.code', Code2),
  icon('pets', 'customLists.icons.pets', PawPrint),
  icon('auto_awesome', 'customLists.icons.sparkle', Sparkles),
  icon('lightbulb', 'customLists.icons.idea', Lightbulb),
  icon('bookmark', 'customLists.icons.bookmark', Bookmark),
  icon('flag', 'customLists.icons.flag', Flag),
  icon('build', 'customLists.icons.build', Wrench),
  icon('palette', 'customLists.icons.palette', Palette),
]

/** The icon for a stored key, or undefined for none or one this version does not know. */
export function customListIcon(key: string | undefined): LucideIcon | undefined {
  return CUSTOM_LIST_ICONS.find((option) => option.key === key)?.icon
}

/** The key of a list drawn without an icon (cross-app semantics 3): its name starts where the icon would be. */
export const LIST_ICON_NONE = 'none'

/** The None choice of the icon picker. */
export const NONE_ICON_OPTION = icon(LIST_ICON_NONE, 'customLists.icons.none', Ban)

/** What a list is drawn with: its icon, `fallback` for an empty or unknown key, or null for None. */
export function listIconOrNone(key: string | undefined, fallback: LucideIcon): LucideIcon | null {
  if (key === LIST_ICON_NONE) return null
  return customListIcon(key) ?? fallback
}
