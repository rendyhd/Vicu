import {
  Ban,
  Bookmark, Briefcase, Code2, Dumbbell, Flag, Folder, GraduationCap, Heart, Home, Lightbulb,
  ListFilter, Palette, PawPrint, ShoppingCart, Sparkles, Star, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// The icons a custom list can have. The key is what syncs (`icon` in the custom-lists carrier) and
// the mobile app draws the same keys (IconRegistry.PRESET_ICONS), so a key is never renamed.

export interface CustomListIcon {
  key: string
  label: string
  icon: LucideIcon
}

export const DEFAULT_CUSTOM_LIST_ICON = 'filter_list'

export const CUSTOM_LIST_ICONS: readonly CustomListIcon[] = [
  { key: 'filter_list', label: 'Filter', icon: ListFilter },
  { key: 'folder', label: 'Folder', icon: Folder },
  { key: 'star', label: 'Star', icon: Star },
  { key: 'favorite', label: 'Heart', icon: Heart },
  { key: 'home', label: 'Home', icon: Home },
  { key: 'work', label: 'Work', icon: Briefcase },
  { key: 'school', label: 'School', icon: GraduationCap },
  { key: 'shopping_cart', label: 'Cart', icon: ShoppingCart },
  { key: 'fitness', label: 'Fitness', icon: Dumbbell },
  { key: 'code', label: 'Code', icon: Code2 },
  { key: 'pets', label: 'Pets', icon: PawPrint },
  { key: 'auto_awesome', label: 'Sparkle', icon: Sparkles },
  { key: 'lightbulb', label: 'Idea', icon: Lightbulb },
  { key: 'bookmark', label: 'Bookmark', icon: Bookmark },
  { key: 'flag', label: 'Flag', icon: Flag },
  { key: 'build', label: 'Build', icon: Wrench },
  { key: 'palette', label: 'Palette', icon: Palette },
]

/** The icon for a stored key, or undefined for none or one this version does not know. */
export function customListIcon(key: string | undefined): LucideIcon | undefined {
  return CUSTOM_LIST_ICONS.find((option) => option.key === key)?.icon
}

/** The key of a list drawn without an icon (cross-app semantics 3): its name starts where the icon would be. */
export const LIST_ICON_NONE = 'none'

/** The None choice of the icon picker. */
export const NONE_ICON_OPTION = { key: LIST_ICON_NONE, label: 'None', icon: Ban }

/** What a list is drawn with: its icon, `fallback` for an empty or unknown key, or null for None. */
export function listIconOrNone(key: string | undefined, fallback: LucideIcon): LucideIcon | null {
  if (key === LIST_ICON_NONE) return null
  return customListIcon(key) ?? fallback
}
