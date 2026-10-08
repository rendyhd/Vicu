/**
 * The closing of a completed row once its hold has ended (docs/design-system-v1.md section 6): the
 * row fades and its height closes with the move spring. Reduced motion: a fade only, no height.
 * The numbers come from the tokens (`--dur-move`, `--spring-move`, `--dur-fade-fast`).
 */

/** "320ms" or "0.32s" as milliseconds; `fallback` when the value is empty or not a time. */
export function parseCssMs(value: string, fallback: number): number {
  const match = /^\s*(-?\d*\.?\d+)\s*(ms|s)\s*$/.exec(value)
  if (!match) return fallback
  const n = Number(match[1])
  return match[2] === 's' ? n * 1000 : n
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Plays the close on the row element and returns the animation; the caller takes the row out when it finishes. */
export function playRowClose(el: HTMLElement, reduced: boolean): Animation {
  if (reduced) {
    return el.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: parseCssMs(token('--dur-fade-fast'), 150),
      easing: 'linear',
      fill: 'forwards',
    })
  }
  const style = getComputedStyle(el)
  const height = el.getBoundingClientRect().height
  return el.animate(
    [
      {
        height: `${height}px`,
        opacity: 1,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        borderBottomWidth: style.borderBottomWidth,
        overflow: 'hidden',
      },
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px', overflow: 'hidden' },
    ],
    {
      duration: parseCssMs(token('--dur-move'), 320),
      easing: token('--spring-move') || 'ease',
      fill: 'forwards',
    }
  )
}

/**
 * The opening of a row that was added to a list (card 4.8): the mirror of `playRowClose`. The row
 * grows from no height with the move spring while it fades in, so the rows below it make room
 * smoothly. Reduced motion: a fade only.
 */
export function playRowOpen(el: HTMLElement, reduced: boolean): Animation {
  if (reduced) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: parseCssMs(token('--dur-fade-fast'), 150),
      easing: 'linear',
    })
  }
  const style = getComputedStyle(el)
  const height = el.getBoundingClientRect().height
  return el.animate(
    [
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px', overflow: 'hidden' },
      {
        height: `${height}px`,
        opacity: 1,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        borderBottomWidth: style.borderBottomWidth,
        overflow: 'hidden',
      },
    ],
    {
      duration: parseCssMs(token('--dur-move'), 320),
      easing: token('--spring-move') || 'ease',
    }
  )
}
