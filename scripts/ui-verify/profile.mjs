// Writes throwaway Vicu profiles (VICU_USER_DATA_DIR folders) that point at the seeded test server
// with the API token from .local/.
//
//   node scripts/ui-verify/profile.mjs [light|dark|both]      (default: both)
//
// Each profile is rebuilt from scratch (no leftover queue, caches or window state), so a run never
// depends on an earlier one. Quick Entry and Quick View are switched on with unusual hotkeys, so a
// harness run never takes the hotkeys of a Vicu you are using. desktop.mjs calls writeProfile()
// itself before every launch; the CLI is for looking at a profile or starting the app by hand:
//
//   VICU_USER_DATA_DIR=scripts/ui-verify/.local/profile-light npx electron .
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL, SERVER_URL, ensureApiToken, ensureUserAndLogin, localPath, readSeedIds } from './lib.mjs'

export const THEMES = ['light', 'dark']

export function profileDir(theme) {
  return localPath(`profile-${theme}`)
}

/**
 * Rebuilds the profile folder for `theme` and returns its path. `size` is the window size the
 * app starts with ({ width, height }).
 */
export async function writeProfile(theme, { size = { width: 1280, height: 820 } } = {}) {
  if (!THEMES.includes(theme)) throw new Error(`Unknown theme "${theme}" (light or dark).`)
  const ids = readSeedIds()
  const { jwt } = await ensureUserAndLogin()
  const token = await ensureApiToken(jwt)

  const dir = resolve(profileDir(theme))
  if (!dir.startsWith(resolve(LOCAL) + sep)) {
    throw new Error(`Refusing to reset a profile outside ${LOCAL}: ${dir}`)
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 })
  mkdirSync(dir, { recursive: true })

  const config = {
    vikunja_url: SERVER_URL,
    api_token: token, // the app moves it into its own token store on the first start
    auth_method: 'api_token',
    inbox_project_id: ids.inbox,
    theme,
    window_bounds: { x: 0, y: 0, width: size.width, height: size.height },
    subtask_display: 'expandable',
    review: { enabled: true, default_cadence_days: 7, exclude_inbox: true },
    nlp_enabled: true,
    nlp_syntax_mode: 'vikunja',
    // Quick Entry and Quick View exist only when switched on. The hotkeys are not the defaults.
    quick_entry_enabled: true,
    quick_view_enabled: true,
    quick_entry_hotkey: 'Ctrl+Alt+Shift+F9',
    quick_view_hotkey: 'Ctrl+Alt+Shift+F10',
    quick_entry_default_project_id: ids.inbox,
    // Quiet runs: no sounds, no notifications, no prompts to confirm.
    notifications_enabled: false,
    task_completion_sound_enabled: false,
    confirm_before_delete: false,
    browser_link_mode: 'off',
    obsidian_mode: 'off',
  }
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n')
  return dir
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const which = process.argv[2] ?? 'both'
  const themes = which === 'both' ? THEMES : [which]
  for (const theme of themes) {
    const dir = await writeProfile(theme)
    console.log(`profile ${theme}: ${relative(process.cwd(), dir) || dir}`)
  }
}
