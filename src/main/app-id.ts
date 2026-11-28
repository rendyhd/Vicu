/**
 * The application id. Must equal `appId` in electron-builder.yml: on Windows the installer stamps
 * it on the Start Menu shortcut as the AppUserModelID, and toast attribution and click-to-activate
 * only work when the running process uses the same one (D-WIN-1).
 */
export const APP_ID = 'com.rendyhd.vicu'

/** The AppUserModelID of a development run or a throwaway profile. */
export const DEV_APP_ID = `${APP_ID}.dev`

/**
 * The AppUserModelID this run uses on Windows. Windows groups taskbar buttons by it, so a
 * development run or a run with a throwaway profile (VICU_USER_DATA_DIR: the harness, manual tests)
 * gets its own: with the installed app's id its windows joined the installed Vicu's taskbar button,
 * and a test that set a count badge and was then killed left that number on the user's button.
 * Toasts of such a run are not attributed to the installed Start menu shortcut.
 */
export function appUserModelId(run: { packaged: boolean; userDataOverride: boolean }): string {
  return run.packaged && !run.userDataOverride ? APP_ID : DEV_APP_ID
}
