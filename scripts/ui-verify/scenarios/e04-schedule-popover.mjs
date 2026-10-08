// E4: the Schedule popover on the last Today row stays inside the window, flips above when there
// is no room below, scrolls inside itself in a short window, and Escape closes it and returns
// focus to the Schedule button. Written against behaviour only (no class names of the popover),
// so it holds before and after the popover rework.
export const meta = {
  id: 'E4',
  wave: 1,
  title: 'Schedule on the last Today row at 1280x820 and 900x600: inside the window, flipped above, inner scroll, Escape and focus return',
}

const SIZES = [
  [1280, 820],
  [900, 600],
]

/** The box and scroll state of the popover that holds the "Tomorrow" shortcut, or null. */
async function readPopover(page) {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Tomorrow')
    if (!btn) return null
    let el = btn.parentElement
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if (el.hasAttribute('popover') || el.getAttribute('role') === 'dialog' || cs.position === 'absolute' || cs.position === 'fixed') break
      el = el.parentElement
    }
    if (!el || el === document.body) return null
    const r = el.getBoundingClientRect()
    let topLayer = false
    try {
      topLayer = el.matches(':popover-open')
    } catch {
      // not supported
    }
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      topLayer,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }
  })
}

export default async function run(h) {
  const page = h.page

  for (const [w, hgt] of SIZES) {
    const tag = `${w}x${hgt}`
    await h.resize(w, hgt)
    await h.dismiss()
    await h.goto('/today')

    const row = h.lastRow()
    const id = await row.getAttribute('data-task-id')
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    const trigger = page.locator(`[data-task-id="${id}"] button[title="Schedule"]`)
    await trigger.click()
    await h.wait(500)

    const pop = await readPopover(page)
    await h.capture(`popover-${tag}`)
    const open = await h.assert(`${tag}: the Schedule popover opens`, !!pop)
    if (!open) continue

    const tb = await trigger.boundingBox()
    await h.assert(`${tag}: popover is inside the window`, {
      ok: pop.x >= -0.5 && pop.y >= -0.5 && pop.right <= pop.innerWidth + 0.5 && pop.bottom <= pop.innerHeight + 0.5,
      detail: `box ${Math.round(pop.x)},${Math.round(pop.y)} to ${Math.round(pop.right)},${Math.round(pop.bottom)} in ${pop.innerWidth}x${pop.innerHeight}`,
    })

    // Flipped above when it does not fit below the button; below otherwise.
    const spaceBelow = pop.innerHeight - tb.y - tb.height
    const fitsBelow = spaceBelow >= pop.height
    await h.assert(`${tag}: popover sits ${fitsBelow ? 'below' : 'above'} the button (${fitsBelow ? 'room below' : 'no room below'})`, {
      ok: fitsBelow ? pop.y >= tb.y + tb.height - 1 : pop.bottom <= tb.y + 1,
      detail: `button ${Math.round(tb.y)}-${Math.round(tb.y + tb.height)}, popover ${Math.round(pop.y)}-${Math.round(pop.bottom)}, space below ${Math.round(spaceBelow)}`,
    })

    // In a short window the popover scrolls inside itself instead of leaving the window.
    if (hgt <= 600) {
      const scrolls = pop.scrollHeight <= pop.clientHeight + 1 || ['auto', 'scroll'].includes(pop.overflowY)
      await h.assert(`${tag}: popover content scrolls inside it when it is taller than the space`, {
        ok: scrolls && pop.height <= pop.innerHeight,
        detail: `height ${Math.round(pop.height)}, content ${pop.scrollHeight}, overflow-y ${pop.overflowY}`,
      })
    }

    // Arrow keys and End move through the day grid (the keyboard grid arrives with wave 3).
    if (h.wave !== null && h.wave >= 3) h.emit({ t: 'skip', id: 'E4', wave: 3, message: 'arrow and End navigation of the day grid: not implemented yet' })

    await h.key('Escape')
    await h.wait(350)
    const after = await readPopover(page)
    const closed = !after || after.height === 0
    await h.assert(`${tag}: Escape closes the popover`, closed)
    const focused = await page.evaluate(() => {
      const a = document.activeElement
      return a ? `${a.tagName.toLowerCase()}${a.getAttribute('title') ? `[title=${a.getAttribute('title')}]` : ''}` : 'none'
    })
    await h.assert(`${tag}: focus returns to the Schedule button`, { ok: closed && focused === 'button[title=Schedule]', detail: focused })
  }
}
