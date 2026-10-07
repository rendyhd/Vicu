/**
 * When Quick Entry needs to know which app was in the foreground (D-PERF-1).
 *
 * The lookup is only worth anything to the Obsidian note link and the browser link. On macOS it
 * spawns an osascript process, which used to run on every hotkey before the window showed, even with
 * both features off. Now it runs only when a feature that uses it is on, and never longer than
 * `FOREGROUND_LOOKUP_TIMEOUT_MS`.
 *
 * The answer cannot move after the window is shown: showing Quick Entry takes the focus, and from
 * then on the foreground app is Vicu itself. On Windows the lookup is a synchronous call that takes
 * no time at all and on Linux there is none, so only macOS with a link feature turned on waits, and
 * that wait is capped.
 */

export const FOREGROUND_LOOKUP_TIMEOUT_MS = 400

export interface ForegroundConfig {
  obsidian_mode?: string
  obsidian_api_key?: string
  browser_link_mode?: string
}

export interface ForegroundNeeds {
  /** The Obsidian note link is on and can run here. */
  obsidian: boolean
  /** The browser link is on. */
  browser: boolean
  /** Either: the foreground app has to be looked up. */
  any: boolean
}

/**
 * Which features want the foreground app. Obsidian is off on Linux by design: Wayland restricts
 * foreground-process detection, and an Obsidian fetch on every show would surprise users who are
 * not working in Obsidian.
 */
export function foregroundNeeds(config: ForegroundConfig | null | undefined, isLinux: boolean): ForegroundNeeds {
  const obsidian = !isLinux && !!(config?.obsidian_mode && config.obsidian_mode !== 'off' && config.obsidian_api_key)
  const browser = !!(config?.browser_link_mode && config.browser_link_mode !== 'off')
  return { obsidian, browser, any: obsidian || browser }
}

/**
 * The foreground process name, or '' when nothing needs it, it cannot be told, or it takes longer
 * than `timeoutMs`. `getName` is not called at all when no feature needs the answer.
 */
export async function lookUpForeground(
  needs: ForegroundNeeds,
  getName: () => Promise<string>,
  timeoutMs: number = FOREGROUND_LOOKUP_TIMEOUT_MS
): Promise<string> {
  if (!needs.any) return ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getName(),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(''), timeoutMs)
      }),
    ])
  } catch {
    return ''
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
