/** Command-line flag that starts the app without showing the main window (in the tray). */
export const START_HIDDEN_ARG = '--hidden'

export interface LoginItemSettingsInput {
  openAtLogin: boolean
  isMac: boolean
  /** Start in the tray: a Windows login item gets --hidden; macOS detects a login launch instead. */
  startHidden?: boolean
}

export interface LoginItemSettingsPayload {
  openAtLogin: boolean
  name?: string
  args?: string[]
}

/**
 * Build Electron login-item settings (Windows and macOS; Linux uses an XDG autostart entry, see
 * autostart-linux.ts). Electron 44 removed `openAsHidden` (it only worked on macOS 12 and earlier,
 * which Electron 44 no longer supports), and a macOS login item cannot carry arguments, so on macOS
 * a hidden start is decided at launch from `wasOpenedAtLogin` (see shouldStartHidden).
 */
export function buildLoginItemSettings(input: LoginItemSettingsInput): LoginItemSettingsPayload {
  if (input.isMac) {
    return { openAtLogin: input.openAtLogin, name: 'Vicu' }
  }
  if (input.openAtLogin && input.startHidden) {
    return { openAtLogin: true, args: [START_HIDDEN_ARG] }
  }
  return { openAtLogin: input.openAtLogin }
}

/** True when the command line asks for a hidden start (and is not, say, `--hidden-x`). */
export function parseHiddenArg(argv: readonly string[]): boolean {
  return argv.includes(START_HIDDEN_ARG)
}

export interface StartHiddenInput {
  /** The command line has --hidden (Windows login item, Linux autostart entry, or typed by hand). */
  hiddenArg: boolean
  /** macOS: app.getLoginItemSettings().wasOpenedAtLogin */
  openedAtLogin: boolean
  /** The "Start hidden" setting. */
  startHiddenSetting: boolean
  isMac: boolean
  /** There is a tray icon (or, on macOS, the dock) to bring the window back from. */
  canComeBack: boolean
}

/**
 * Whether this launch should leave the main window hidden. Only when the user can get it back:
 * with no tray icon on Windows or Linux a hidden window would leave the app with no visible part.
 */
export function shouldStartHidden(input: StartHiddenInput): boolean {
  if (!input.canComeBack) return false
  if (input.hiddenArg) return true
  return input.isMac && input.openedAtLogin && input.startHiddenSetting
}
