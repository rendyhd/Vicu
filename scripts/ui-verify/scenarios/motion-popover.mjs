// motion-popover (card 4.1): popovers, menus and tooltips enter from their anchor and leave fading.
//
//   With full motion (the harness default, this PC reports reduce otherwise):
//     A popover (Schedule), a menu (the row context menu) and a tooltip (a card toolbar button) each
//       - enter with a scale from 0.96 and a fade: a free-running requestAnimationFrame sample sees
//         opacity below 1 and scale between 0.96 and 1 on more than one frame, and ends at 1 and none;
//       - are frozen at 12 percent of their own transition (animations paused, currentTime set) for a
//         deterministic mid-animation value and a capture;
//       - leave as a fading copy ([data-leaving]: not a popover, no role, inert) that is gone within
//         a second and leaves no open popover behind.
//   With --motion reduce (emulated for the rest of the scenario):
//     the same three never have a scale, transform or translate while entering or leaving, only
//     opacity changes.
export const meta = {
  id: 'MP',
  wave: 4,
  title: 'Popover, menu and tooltip enter from the anchor (scale 0.96 to 1 with a fade) and leave fading; reduced motion: opacity only',
}

const KINDS = [
  { key: 'popover', selector: '[popover][role="dialog"]' },
  { key: 'menu', selector: '[popover][role="menu"]' },
  { key: 'tooltip', selector: '[popover][role="tooltip"]' },
]

/**
 * Starts a requestAnimationFrame sampler in the page and returns at once. It records the computed
 * opacity, scale, transform and translate of the first open element matching `selector` on every
 * frame while it shows. With `freeze` it also pauses that element's animations at 12 percent on the
 * first frame it sees them (released by `release`). With `leaving` it samples `[data-leaving]`
 * instead.
 */
async function startSampler(page, { selector, freeze = false, leaving = false }) {
  await page.evaluate(
    ({ selector, freeze, leaving }) => {
      const state = { samples: [], frozen: null, anims: [], ghostRole: null, ghostPopover: null, ghostInert: null }
      window.__mp = state
      const end = performance.now() + 2500
      const read = (el) => {
        const cs = getComputedStyle(el)
        return { t: performance.now(), opacity: +cs.opacity, scale: cs.scale, transform: cs.transform, translate: cs.translate, display: cs.display }
      }
      const tick = () => {
        if (leaving) {
          const ghost = document.querySelector('[data-leaving]')
          if (ghost) {
            state.samples.push(read(ghost))
            state.ghostRole = ghost.getAttribute('role')
            state.ghostPopover = ghost.hasAttribute('popover')
            state.ghostInert = ghost.hasAttribute('inert')
          }
        } else {
          const el = [...document.querySelectorAll(selector)].find((x) => x.matches(':popover-open'))
          if (el) {
            if (freeze && !state.frozen) {
              const anims = el.getAnimations()
              for (const a of anims) {
                const duration = a.effect?.getComputedTiming().duration ?? 0
                a.pause()
                a.currentTime = 0.12 * Number(duration)
              }
              state.anims = anims
              state.frozen = { ...read(el), animations: anims.length }
              return
            }
            state.samples.push(read(el))
          }
        }
        if (performance.now() < end) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { selector, freeze, leaving },
  )
}

const readSamples = (page) => page.evaluate(() => window.__mp)
const release = (page) => page.evaluate(() => (window.__mp?.anims ?? []).forEach((a) => a.play()))

/** A scale value from computed style: "none" is 1. */
const scaleOf = (s) => (s === 'none' || s === '' ? 1 : Number(s.split(' ')[0]))
const noTransform = (s) => (s.scale === 'none' || scaleOf(s.scale) === 1) && (s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)') && (s.translate === 'none' || /^0(px)?( 0(px)?)?$/.test(s.translate))

async function openCard(h, page) {
  await h.dismiss()
  await h.goto('/today')
  const row = h.lastRow()
  const id = await row.getAttribute('data-task-id')
  await row.scrollIntoViewIfNeeded()
  await row.click({ position: { x: 180, y: 12 } })
  await h.wait(700)
  return id
}

/** How to open and close each kind; `cardId` is the open card's task id. */
function actions(h, page, cardId) {
  return {
    popover: {
      async open() {
        await page.locator(`[data-task-id="${cardId}"] button[data-prop="schedule"]`).click()
      },
      async close() {
        await h.key('Escape')
      },
    },
    menu: {
      async open() {
        await page.locator('[data-task-id]').first().click({ button: 'right' })
      },
      async close() {
        await h.key('Escape')
      },
    },
    tooltip: {
      async open() {
        await page.locator(`[data-task-id="${cardId}"] button[data-prop="priority"]`).hover()
        await h.wait(450)
      },
      async close() {
        await page.mouse.move(2, 2)
      },
    },
  }
}

/** Nothing is left open or leaving (a tooltip may show for the button that got focus back). */
const settled = (page) =>
  page.evaluate(() => ({
    open: [...document.querySelectorAll('[popover]:not([role="tooltip"])')].filter((x) => x.matches(':popover-open')).length,
    ghosts: document.querySelectorAll('[data-leaving]').length,
  }))

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.setMotion('full')

  // ---- Full motion ---------------------------------------------------------------------------
  for (const kind of KINDS) {
    const cardId = await openCard(h, page)
    const act = actions(h, page, cardId)[kind.key]
    const t = kind.key

    // Free-running sample of the enter.
    await startSampler(page, { selector: kind.selector })
    await act.open()
    await h.wait(900)
    const free = await readSamples(page)
    await h.assert(`${t}: the enter is sampled on several frames`, { ok: free.samples.length >= 3, detail: `${free.samples.length} frames` })
    const early = free.samples.filter((s) => s.opacity < 0.98)
    await h.assert(`${t}: it fades in (opacity below 1 on at least 2 frames, rising to 1)`, {
      ok: early.length >= 2 && free.samples[free.samples.length - 1]?.opacity === 1,
      detail: `${early.length} frames below 1, last ${free.samples[free.samples.length - 1]?.opacity}`,
    })
    const scaling = free.samples.filter((s) => scaleOf(s.scale) < 0.999 && scaleOf(s.scale) >= 0.95)
    await h.assert(`${t}: it scales in from 0.96 (a scale between 0.96 and 1 on at least 2 frames)`, {
      ok: scaling.length >= 2,
      detail: `${scaling.length} frames, first scale ${free.samples[0]?.scale}`,
    })
    await h.assert(`${t}: it rests at opacity 1 and no scale`, {
      ok: free.samples.length > 0 && free.samples[free.samples.length - 1].opacity === 1 && scaleOf(free.samples[free.samples.length - 1].scale) === 1,
      detail: JSON.stringify(free.samples[free.samples.length - 1]),
    })

    // Leave: a fading copy.
    await startSampler(page, { selector: kind.selector, leaving: true })
    await act.close()
    await h.wait(120)
    const leaving = await readSamples(page)
    await h.assert(`${t}: it leaves as a copy (data-leaving) that fades`, {
      ok: leaving.samples.length >= 1 && leaving.samples.some((s) => s.opacity < 1),
      detail: `${leaving.samples.length} frames, opacities ${leaving.samples.map((s) => s.opacity.toFixed(2)).join(' ')}`,
    })
    await h.assert(`${t}: the leaving copy is not a popover, has no role and is inert`, {
      ok: leaving.ghostPopover === false && leaving.ghostRole === null && leaving.ghostInert === true,
      detail: JSON.stringify({ popover: leaving.ghostPopover, role: leaving.ghostRole, inert: leaving.ghostInert }),
    })
    await h.wait(900)
    const after = await settled(page)
    await h.assert(`${t}: after the leave no copy and no popover is left`, { ok: after.ghosts === 0 && after.open === 0, detail: JSON.stringify(after) })

    // Frozen mid-animation frame, for a deterministic value and a capture.
    await startSampler(page, { selector: kind.selector, freeze: true })
    await act.open()
    await h.wait(300)
    const frozen = (await readSamples(page)).frozen
    if (!frozen) {
      await h.assert(`${t}: a mid-animation frame was frozen`, false)
    } else {
      await h.capture(`${t}-mid-enter`)
      await h.assert(`${t}: mid-animation the opacity is between start and end`, { ok: frozen.opacity > 0.02 && frozen.opacity < 0.98, detail: `opacity ${frozen.opacity}` })
      await h.assert(`${t}: mid-animation the scale is between 0.96 and 1`, { ok: scaleOf(frozen.scale) > 0.96 && scaleOf(frozen.scale) < 1, detail: `scale ${frozen.scale}` })
    }
    await release(page)
    await h.wait(500)
    await h.capture(`${t}-open`)
    await act.close()
    await h.wait(900)
  }

  // ---- Reduced motion ------------------------------------------------------------------------
  await h.setMotion('reduce')
  await h.assert('prefers-reduced-motion is emulated as reduce', () => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
  for (const kind of KINDS) {
    const cardId = await openCard(h, page)
    const act = actions(h, page, cardId)[kind.key]
    const t = `${kind.key} (reduced)`

    await startSampler(page, { selector: kind.selector })
    await act.open()
    await h.wait(700)
    const free = await readSamples(page)
    await h.assert(`${t}: it enters and is sampled`, { ok: free.samples.length >= 2, detail: `${free.samples.length} frames` })
    const moved = free.samples.filter((s) => !noTransform(s))
    await h.assert(`${t}: no scale, transform or translate on any frame of the enter`, {
      ok: moved.length === 0,
      detail: moved.length ? JSON.stringify(moved[0]) : `${free.samples.length} frames`,
    })
    if (kind.key === 'popover') await h.capture(`${kind.key}-reduced`)

    await startSampler(page, { selector: kind.selector, leaving: true })
    await act.close()
    await h.wait(120)
    const leaving = await readSamples(page)
    const movedOut = leaving.samples.filter((s) => !noTransform(s))
    await h.assert(`${t}: no scale, transform or translate on the leaving copy`, {
      ok: movedOut.length === 0,
      detail: movedOut.length ? JSON.stringify(movedOut[0]) : `${leaving.samples.length} frames`,
    })
    await h.wait(900)
    const after = await settled(page)
    await h.assert(`${t}: after the leave no copy and no popover is left`, { ok: after.ghosts === 0 && after.open === 0, detail: JSON.stringify(after) })
  }
  await h.setMotion('full')
  await h.dismiss()
}
