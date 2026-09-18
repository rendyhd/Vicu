export interface LoginItemSettingsInput {
  openAtLogin: boolean
  isMac: boolean
}

export interface LoginItemSettingsPayload {
  openAtLogin: boolean
  name?: string
}

/**
 * Build Electron login-item settings. Electron 44 removed `openAsHidden`
 * (it only worked on macOS 12 and earlier, which Electron 44 no longer supports).
 */
export function buildLoginItemSettings(input: LoginItemSettingsInput): LoginItemSettingsPayload {
  if (input.isMac) {
    return { openAtLogin: input.openAtLogin, name: 'Vicu' }
  }
  return { openAtLogin: input.openAtLogin }
}
