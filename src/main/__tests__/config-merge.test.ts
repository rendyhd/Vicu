import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { isQuickEntryEnabled, isQuickViewEnabled } from '../../shared/config-types'
import {
  applyConfigPatch,
  applyConnectionFields,
  CONNECTION_KEYS,
  connectionKeysIn,
  isConnectionFields,
  normalizeConfig,
  type AppConfig,
  type ConnectionFields,
} from '../config'

/** A config as a long-time user has it: many preferences and state owned by main. */
function userConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return normalizeConfig({
    vikunja_url: 'https://tasks.example.com',
    api_token: '',
    inbox_project_id: 7,
    auth_method: 'oidc',
    theme: 'dark',
    window_bounds: { x: 10, y: 20, width: 1200, height: 800 },
    sidebar_width: 333,
    sidebar_collapsed_projects: [4, 9],
    quick_entry_enabled: true,
    quick_view_enabled: true,
    quick_entry_hotkey: 'Ctrl+Alt+N',
    quick_view_hotkey: 'Ctrl+Alt+B',
    quick_entry_default_project_id: 9,
    secondary_projects: [{ id: 11, title: 'Work' }],
    quick_entry_position: { x: 1, y: 2 },
    quick_view_position: { x: 3, y: 4 },
    viewer_filter: { project_ids: [9], sort_by: 'priority', order_by: 'desc', due_date_filter: 'week' },
    launch_on_startup: true,
    show_today_overdue_badge: true,
    show_project_progress: false,
    notifications_enabled: true,
    notifications_daily_reminder_time: '07:30',
    notifications_sound: false,
    task_completion_sound_enabled: false,
    task_completion_sound_path: 'C:\\sounds\\done.wav',
    last_file_dialog_directory: 'C:\\Users\\me\\Documents',
    update_check_dismissed_version: '9.9.9',
    last_used_project_id: 9,
    last_used_label_id: 3,
    last_username: 'alice',
    custom_lists: [
      {
        id: 'list-1',
        name: 'Focus',
        filter: { project_ids: [9], sort_by: 'due_date', order_by: 'asc', due_date_filter: 'all' },
      },
    ],
    custom_lists_sync: {
      device_id: 'dev-1',
      document: { version: 1, revision: 4 } as never,
      dirty: false,
    },
    review: { enabled: false, default_cadence_days: 30, exclude_inbox: false },
    ...overrides,
  })
}

const PREFERENCE_KEYS = [
  'theme',
  'clock_format',
  'window_bounds',
  'sidebar_width',
  'quick_entry_enabled',
  'quick_view_enabled',
  'quick_entry_hotkey',
  'quick_view_hotkey',
  'quick_entry_position',
  'quick_view_position',
  'launch_on_startup',
  'show_today_overdue_badge',
  'show_project_progress',
  'notifications_enabled',
  'notifications_daily_reminder_time',
  'notifications_sound',
  'task_completion_sound_enabled',
  'task_completion_sound_path',
  'last_file_dialog_directory',
  'update_check_dismissed_version',
  'review',
] as const satisfies readonly (keyof AppConfig)[]

const ACCOUNT_KEYS = [
  'quick_entry_default_project_id',
  'secondary_projects',
  'last_used_project_id',
  'last_used_label_id',
  'last_username',
  'custom_lists',
  'custom_lists_sync',
  'sidebar_collapsed_projects',
] as const satisfies readonly (keyof AppConfig)[]

function expectKeysKept(result: AppConfig, before: AppConfig, keys: readonly (keyof AppConfig)[]) {
  for (const key of keys) expect(result[key], key).toEqual(before[key])
}

describe('applyConnectionFields: re-login on the same server (D-SETUP-1)', () => {
  const before = userConfig()

  it('the OIDC partial save changes only the connection fields', () => {
    const result = applyConnectionFields(before, {
      vikunja_url: 'https://tasks.example.com',
      api_token: '',
      auth_method: 'oidc',
    })

    expectKeysKept(result, before, PREFERENCE_KEYS)
    expectKeysKept(result, before, ACCOUNT_KEYS)
    expect(result.viewer_filter).toEqual(before.viewer_filter)
    expect(result.inbox_project_id).toBe(7)
    expect(result.auth_method).toBe('oidc')
  })

  it('the password partial save keeps everything too, switching only the auth method', () => {
    const result = applyConnectionFields(before, {
      vikunja_url: 'https://tasks.example.com/',
      api_token: '',
      auth_method: 'password',
    })

    expectKeysKept(result, before, PREFERENCE_KEYS)
    expectKeysKept(result, before, ACCOUNT_KEYS)
    expect(result.auth_method).toBe('password')
    expect(result.vikunja_url).toBe('https://tasks.example.com')
  })

  it('the final save sets the chosen inbox and the API token', () => {
    const result = applyConnectionFields(before, {
      vikunja_url: 'https://tasks.example.com',
      api_token: 'tk_abc',
      auth_method: 'api_token',
      inbox_project_id: 42,
    })

    expect(result).toMatchObject({ inbox_project_id: 42, api_token: 'tk_abc', auth_method: 'api_token' })
    expectKeysKept(result, before, PREFERENCE_KEYS)
    expectKeysKept(result, before, ACCOUNT_KEYS)
  })

  it('treats a trailing slash as the same server', () => {
    const result = applyConnectionFields(userConfig({ vikunja_url: 'https://tasks.example.com/' }), {
      vikunja_url: 'https://tasks.example.com',
      api_token: '',
      auth_method: 'oidc',
    })

    expectKeysKept(result, before, ACCOUNT_KEYS)
  })
})

describe('applyConnectionFields: another server or account', () => {
  const before = userConfig()
  const other: ConnectionFields = {
    vikunja_url: 'https://other.example.org',
    api_token: '',
    auth_method: 'password',
  }

  it('keeps every preference but drops the previous account data', () => {
    const result = applyConnectionFields(before, other)

    expectKeysKept(result, before, PREFERENCE_KEYS)
    expect(result.vikunja_url).toBe('https://other.example.org')
    expect(result.custom_lists).toBeUndefined()
    expect(result.custom_lists_sync).toBeUndefined()
    expect(result.quick_entry_default_project_id).toBeUndefined()
    expect(result.secondary_projects).toEqual([])
    expect(result.last_used_project_id).toBeUndefined()
    expect(result.last_used_label_id).toBeUndefined()
    expect(result.last_username).toBeUndefined()
    expect(result.sidebar_collapsed_projects).toBeUndefined()
    expect(result.standalone_mode).toBe(false)
    expect(result.viewer_filter).toMatchObject({ project_ids: [], sort_by: 'due_date' })
  })

  it('sidebar_collapsed_projects keeps whole positive ids, once each, ascending', () => {
    expect(normalizeConfig({ sidebar_collapsed_projects: [9, 4, 4, 0, -2, 1.5, 'x', null] }).sidebar_collapsed_projects).toEqual([4, 9])
    expect(normalizeConfig({ sidebar_collapsed_projects: 'nope' }).sidebar_collapsed_projects).toBeUndefined()
    expect(normalizeConfig({}).sidebar_collapsed_projects).toBeUndefined()
  })

  it('does not carry the old inbox project over', () => {
    expect(applyConnectionFields(before, other).inbox_project_id).toBe(0)
    expect(applyConnectionFields(before, { ...other, inbox_project_id: 5 }).inbox_project_id).toBe(5)
  })

  it('leaves standalone mode when connecting from it', () => {
    const standalone = userConfig({ vikunja_url: '', standalone_mode: true, custom_lists: undefined, custom_lists_sync: undefined })
    const result = applyConnectionFields(standalone, { ...other, inbox_project_id: 5 })

    expect(result.standalone_mode).toBe(false)
    expect(result.theme).toBe('dark')
  })

  it('Disconnect clears the connection and account data but keeps preferences', () => {
    const result = applyConnectionFields(before, {
      vikunja_url: '',
      api_token: '',
      auth_method: 'api_token',
      inbox_project_id: 0,
    })

    expect(result).toMatchObject({ vikunja_url: '', api_token: '', inbox_project_id: 0, auth_method: 'api_token' })
    expectKeysKept(result, before, PREFERENCE_KEYS)
    expect(result.custom_lists).toBeUndefined()
    expect(result.custom_lists_sync).toBeUndefined()
    expect(result.quick_entry_default_project_id).toBeUndefined()
  })
})

describe('applyConnectionFields: first run', () => {
  it('builds a normalized config with defaults', () => {
    const result = applyConnectionFields(null, {
      vikunja_url: 'https://tasks.example.com/',
      api_token: 'tk',
      auth_method: 'api_token',
      inbox_project_id: 3,
    })

    expect(result).toMatchObject({
      vikunja_url: 'https://tasks.example.com',
      api_token: 'tk',
      auth_method: 'api_token',
      inbox_project_id: 3,
      theme: 'system',
      notifications_enabled: false,
    })
  })

  it('does not mutate the config it was given', () => {
    const before = userConfig()
    const snapshot = structuredClone(before)
    applyConnectionFields(before, { vikunja_url: 'https://other.example.org', api_token: '', auth_method: 'oidc' })

    expect(before).toEqual(snapshot)
  })
})

describe('isConnectionFields', () => {
  it('accepts the three auth methods with or without an inbox', () => {
    expect(isConnectionFields({ vikunja_url: 'u', api_token: '', auth_method: 'oidc' })).toBe(true)
    expect(isConnectionFields({ vikunja_url: 'u', api_token: 't', auth_method: 'api_token', inbox_project_id: 3 })).toBe(true)
    expect(isConnectionFields({ vikunja_url: 'u', api_token: '', auth_method: 'password', inbox_project_id: 0 })).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(isConnectionFields(null)).toBe(false)
    expect(isConnectionFields('x')).toBe(false)
    expect(isConnectionFields({ vikunja_url: 'u', api_token: '' })).toBe(false)
    expect(isConnectionFields({ vikunja_url: 'u', api_token: '', auth_method: 'basic' })).toBe(false)
    expect(isConnectionFields({ vikunja_url: 5, api_token: '', auth_method: 'oidc' })).toBe(false)
    expect(isConnectionFields({ vikunja_url: 'u', api_token: '', auth_method: 'oidc', inbox_project_id: 'x' })).toBe(false)
    expect(isConnectionFields({ vikunja_url: 'u', api_token: '', auth_method: 'oidc', inbox_project_id: NaN })).toBe(false)
  })
})

describe('applyConfigPatch (D-CFG-2)', () => {
  it('changes only the patched keys', () => {
    const before = userConfig()
    const result = applyConfigPatch(before, { notifications_sound: true, theme: 'light' })

    expect(result.notifications_sound).toBe(true)
    expect(result.theme).toBe('light')
    expect({ ...result, notifications_sound: false, theme: 'dark' }).toEqual(before)
  })

  it('never reverts fields main changed after the renderer loaded its snapshot', () => {
    const snapshotTakenByRenderer = userConfig()
    // Main moves on: the user resized the window, moved a popup, picked a file, dismissed an update...
    const current = userConfig({
      window_bounds: { x: 50, y: 60, width: 900, height: 700 },
      sidebar_width: 280,
      quick_entry_position: { x: 100, y: 200 },
      quick_view_position: { x: 300, y: 400 },
      last_file_dialog_directory: 'D:\Other',
      update_check_dismissed_version: '10.0.0',
      last_used_project_id: 77,
      last_used_label_id: 88,
    })

    // The renderer only reports what the user edited.
    const patch = { launch_on_startup: false, quick_view_hotkey: 'Ctrl+Alt+V' }
    const result = applyConfigPatch(current, patch)

    expect(result.launch_on_startup).toBe(false)
    expect(result.quick_view_hotkey).toBe('Ctrl+Alt+V')
    expect(result.window_bounds).toEqual({ x: 50, y: 60, width: 900, height: 700 })
    expect(result.sidebar_width).toBe(280)
    expect(result.quick_entry_position).toEqual({ x: 100, y: 200 })
    expect(result.quick_view_position).toEqual({ x: 300, y: 400 })
    expect(result.last_file_dialog_directory).toBe('D:\Other')
    expect(result.update_check_dismissed_version).toBe('10.0.0')
    expect(result.last_used_project_id).toBe(77)
    expect(result.last_used_label_id).toBe(88)
    // ...which a whole-snapshot save would have reverted:
    expect(snapshotTakenByRenderer.window_bounds).not.toEqual(result.window_bounds)
  })

  it('ignores custom_lists and custom_lists_sync, which main owns', () => {
    const before = userConfig()
    const result = applyConfigPatch(before, {
      custom_lists: [],
      custom_lists_sync: undefined,
      theme: 'light',
    })

    expect(result.custom_lists).toEqual(before.custom_lists)
    expect(result.custom_lists_sync).toEqual(before.custom_lists_sync)
    expect(result.theme).toBe('light')
  })

  it('ignores keys that are not config fields', () => {
    const before = userConfig()
    const result = applyConfigPatch(before, JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "evil": "x", "theme": "light"}'))

    expect(result).not.toHaveProperty('evil')
    expect(result).not.toHaveProperty('constructor', 1)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(result.theme).toBe('light')
  })

  it('resets a key to its default when the patch value is undefined', () => {
    const result = applyConfigPatch(userConfig(), { update_check_dismissed_version: undefined, notifications_sound: undefined })

    expect(result.update_check_dismissed_version).toBeUndefined()
    expect(result.notifications_sound).toBe(true)
  })

  it('replaces nested settings objects as a whole', () => {
    const result = applyConfigPatch(userConfig(), {
      review: { enabled: true, default_cadence_days: 7, exclude_inbox: true },
      viewer_filter: { project_ids: [1, 2], sort_by: 'title', order_by: 'asc', due_date_filter: 'all' },
    })

    expect(result.review).toEqual({ enabled: true, default_cadence_days: 7, exclude_inbox: true })
    expect(result.viewer_filter).toMatchObject({ project_ids: [1, 2], sort_by: 'title' })
  })

  it('keeps routines on unless they were turned off, and saves a turned-off switch', () => {
    const fresh = normalizeConfig({})
    expect(fresh.routines_enabled).toBe(true)
    expect(fresh.routines_in_today).toBe(true)

    const off = applyConfigPatch(userConfig(), { routines_enabled: false, routines_in_today: false })
    expect(off.routines_enabled).toBe(false)
    expect(off.routines_in_today).toBe(false)
    expect(normalizeConfig({ ...off }).routines_enabled).toBe(false)
  })

  it('keeps the clock choice, and anything else means the system clock', () => {
    expect(normalizeConfig({}).clock_format).toBe('system')
    expect(applyConfigPatch(userConfig(), { clock_format: '24h' }).clock_format).toBe('24h')
    expect(applyConfigPatch(userConfig(), { clock_format: '12h' }).clock_format).toBe('12h')
    expect(applyConfigPatch(userConfig({ clock_format: '24h' }), { clock_format: 'sundial' }).clock_format).toBe('system')
  })

  it('normalizes values (invalid types fall back to defaults)', () => {
    const result = applyConfigPatch(userConfig(), {
      theme: 'neon',
      sidebar_width: 'wide',
      review: { default_cadence_days: 9999 },
    })

    expect(result.theme).toBe('system')
    expect(result.sidebar_width).toBeUndefined()
    expect(result.review?.default_cadence_days).toBe(365)
  })

  it('pointing at another server drops the previous account data', () => {
    const before = userConfig()
    const result = applyConfigPatch(before, {
      vikunja_url: 'https://other.example.org/',
      api_token: 'tk',
      auth_method: 'api_token',
    })

    expect(result.vikunja_url).toBe('https://other.example.org')
    expect(result.custom_lists).toBeUndefined()
    expect(result.custom_lists_sync).toBeUndefined()
    expect(result.quick_entry_default_project_id).toBeUndefined()
    expect(result.theme).toBe('dark')
  })

  it('keeping the same server (even with a trailing slash) keeps the account data', () => {
    const before = userConfig()
    const result = applyConfigPatch(before, { vikunja_url: 'https://tasks.example.com/', api_token: 'tk', auth_method: 'api_token' })

    expect(result.custom_lists).toEqual(before.custom_lists)
    expect(result.quick_entry_default_project_id).toBe(9)
  })

  it('does not mutate the config it was given', () => {
    const before = userConfig()
    const snapshot = structuredClone(before)
    applyConfigPatch(before, { theme: 'light', review: { enabled: true, default_cadence_days: 3, exclude_inbox: true } })

    expect(before).toEqual(snapshot)
  })

  it('accepts an empty patch', () => {
    const before = userConfig()
    expect(applyConfigPatch(before, {})).toEqual(before)
  })
})

describe('start_hidden (D-LNX-1)', () => {
  it('is off unless the config says true', () => {
    expect(normalizeConfig({}).start_hidden).toBe(false)
    expect(normalizeConfig({ start_hidden: 'yes' }).start_hidden).toBe(false)
    expect(normalizeConfig({ start_hidden: true }).start_hidden).toBe(true)
  })

  it('is changed by a patch without touching launch_on_startup', () => {
    const before = userConfig({ launch_on_startup: true })
    const after = applyConfigPatch(before, { start_hidden: true })
    expect(after.start_hidden).toBe(true)
    expect(after.launch_on_startup).toBe(true)
  })
})

describe('Quick Entry and Quick View defaults', () => {
  it('a config without the settings has both turned off, as every reader sees it', () => {
    const config = normalizeConfig({})
    expect(config.quick_view_enabled).toBe(false)
    expect(config.quick_entry_enabled).toBe(false)
    expect(isQuickViewEnabled(config)).toBe(false)
    expect(isQuickEntryEnabled(config)).toBe(false)
  })

  it('keeps an explicit choice through normalizing', () => {
    const config = normalizeConfig({ quick_view_enabled: true, quick_entry_enabled: true })
    expect(isQuickViewEnabled(config)).toBe(true)
    expect(isQuickEntryEnabled(config)).toBe(true)
  })
})

describe('connectionKeysIn (F3)', () => {
  it('names the connection keys of a patch and nothing else', () => {
    expect(connectionKeysIn({ theme: 'light', sidebar_width: 300, inbox_project_id: 4 })).toEqual([])
    expect(connectionKeysIn({ vikunja_url: 'https://x', api_token: 't', auth_method: 'api_token', theme: 'light' })).toEqual([
      'vikunja_url',
      'api_token',
      'auth_method',
    ])
    expect(connectionKeysIn({ standalone_mode: true, last_username: 'a' })).toEqual(['standalone_mode', 'last_username'])
  })

  it('covers every key that says which account the app is signed in to', () => {
    for (const key of ['vikunja_url', 'api_token', 'auth_method']) expect(CONNECTION_KEYS).toContain(key)
  })

  it('does not count the inbox project: Settings changes it as a preference within the account', () => {
    expect(CONNECTION_KEYS).not.toContain('inbox_project_id')
  })
})
