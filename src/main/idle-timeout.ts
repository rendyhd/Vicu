/**
 * A timer that fires only after a period with no activity. A total time limit cuts off a large
 * download on a slow link even though it is making progress; an idle limit does not (D-API-3).
 */
export interface IdleTimeout {
  /** Activity happened: start the period again. No effect once cleared or fired. */
  touch(): void
  /** Stop for good. */
  clear(): void
}

export function createIdleTimeout(ms: number, onIdle: () => void): IdleTimeout {
  let timer: ReturnType<typeof setTimeout> | null = null
  let done = false

  const arm = (): void => {
    timer = setTimeout(() => {
      timer = null
      done = true
      onIdle()
    }, ms)
  }
  arm()

  return {
    touch() {
      if (done) return
      if (timer) clearTimeout(timer)
      arm()
    },
    clear() {
      done = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
