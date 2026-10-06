import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import {
  applyConnectionFields,
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
    expect(result.standalone_mode).toBe(false)
    expect(result.viewer_filter).toMatchObject({ project_ids: [], sort_by: 'due_date' })
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
