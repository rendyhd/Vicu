/**
 * The application id. Must equal `appId` in electron-builder.yml: on Windows the installer stamps
 * it on the Start Menu shortcut as the AppUserModelID, and toast attribution and click-to-activate
 * only work when the running process uses the same one (D-WIN-1).
 */
export const APP_ID = 'com.rendyhd.vicu'
