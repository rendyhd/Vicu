// When the app looks for a new release (D-UPD-1). A tray app can run for weeks, so one check at
// startup is not enough: this checks shortly after start and then every 12 hours. It tells the
// window once per release, and never about the version the user dismissed. No Electron imports,
// so the schedule is unit tested with fake timers.

import type { UpdateStatus } from './update-version'

export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
/** Let the app finish starting before the first network request. */
export const FIRST_UPDATE_CHECK_DELAY_MS = 5_000

export interface UpdateChecksOptions {
  check: () => Promise<UpdateStatus>
  /** The release the user chose to ignore (config `update_check_dismissed_version`). */
  dismissedVersion: () => string | undefined
  /** Show the update. Return false when nobody could be told, so the next check tries again. */
  notify: (status: UpdateStatus) => boolean | void
  intervalMs?: number
  firstDelayMs?: number
}

export interface UpdateChecksHandle {
  stop(): void
}

export function startUpdateChecks(options: UpdateChecksOptions): UpdateChecksHandle {
  let notifiedVersion: string | null = null
  let running = false

  async function run(): Promise<void> {
    if (running) return
    running = true
    try {
      const status = await options.check()
      if (!status.available) return
      if (options.dismissedVersion() === status.latestVersion) return
      if (notifiedVersion === status.latestVersion) return
      if (options.notify(status) !== false) notifiedVersion = status.latestVersion
    } catch {
      // A failed check must never disturb the app; the next one tries again.
    } finally {
      running = false
    }
  }

  const first = setTimeout(() => void run(), options.firstDelayMs ?? FIRST_UPDATE_CHECK_DELAY_MS)
  const periodic = setInterval(() => void run(), options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS)
  // Neither timer may keep the process alive on its own.
  first.unref?.()
  periodic.unref?.()

  return {
    stop() {
      clearTimeout(first)
      clearInterval(periodic)
    },
  }
}
