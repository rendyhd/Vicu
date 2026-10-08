// Shared by E7 (card 4.6) and the view half of E11: changing views through the sidebar.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * Starts a requestAnimationFrame sampler and returns at once. Per frame it records whether a page
 * view transition is active, which pseudo-element groups animate, the opacity and translate of the
 * new and old content images and the transform of the sidebar pill group. With `freeze` the
 * transition's animations are paused at `freezeAt` ms on the first frame they exist.
 */
export async function startSampler(page, { freeze = false, freezeAt = 150 } = {}) {
  await page.evaluate(
    ({ freeze, freezeAt }) => {
      const state = { samples: [], frozen: null, anims: [] }
      window.__vs = state
      const end = performance.now() + 3000
      const html = document.documentElement
      const pseudo = (name) => getComputedStyle(html, name)
      const read = () => {
        const newer = pseudo('::view-transition-new(content)')
        const older = pseudo('::view-transition-old(content)')
        const anims = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement && a.effect.pseudoElement.startsWith('::view-transition'))
        return {
          t: performance.now(),
          active: html.matches(':active-view-transition-type(page)'),
          groups: [...new Set(anims.map((a) => a.effect.pseudoElement.replace(/^::view-transition-(group|old|new|image-pair)\((.*)\)$/, '$2')))],
          newOpacity: Number(newer.opacity),
          newTranslate: newer.translate,
          oldOpacity: Number(older.opacity),
          pillTransform: (() => { const el = document.querySelector('[data-sidebar-pill]'); return el ? getComputedStyle(el).transform : null })(),
          anims,
        }
      }
      const tick = () => {
        const s = read()
        if (freeze && !state.frozen && s.active && s.groups.length > 0) {
          for (const a of s.anims) {
            const duration = Number(a.effect.getComputedTiming().duration)
            const delay = Number(a.effect.getComputedTiming().delay)
            a.pause()
            a.currentTime = Math.min(freezeAt, delay + duration)
          }
          state.anims = s.anims
          const frozen = read()
          delete frozen.anims
          state.frozen = frozen
          return
        }
        delete s.anims
        state.samples.push(s)
        if (performance.now() < end) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { freeze, freezeAt },
  )
}

export const readSampler = (page) => page.evaluate(() => window.__vs)
export const release = (page) => page.evaluate(() => (window.__vs?.anims ?? []).forEach((a) => a.play()))

/** The y of a CSS translate value ("0px 3.2px", "none"). */
export const translateY = (value) => (!value || value === 'none' ? 0 : parseFloat(value.split(' ')[1] ?? '0'))

/** Nothing of a page transition is left on the page. */
export const leftovers = (page) =>
  page.evaluate(() => ({
    active: document.documentElement.matches(':active-view-transition-type(page)'),
    mainName: getComputedStyle(document.querySelector('main')).viewTransitionName,
    pillAnimations: [...document.querySelectorAll('[data-sidebar-pill]')].reduce((n, el) => n + el.getAnimations().length, 0),
    taskNames: [...document.querySelectorAll('[data-task-id]')].filter((el) => el.style.viewTransitionName).length,
    attr: document.documentElement.getAttribute('data-task-transition'),
    route: location.hash,
  }))

const sidebarButton = (page, name) => page.locator('aside nav[aria-label="Lists"] button', { hasText: name }).first()

/**
 * Today to Upcoming by mouse with a frozen mid-transition frame, and the checks that apply to the
 * transition with full motion (`full`) or reduced motion (`!full`).
 */
export async function mouseSwitch(h, page, { full }) {
  const tag = full ? 'full motion' : 'reduced'
  await h.dismiss()
  await h.goto('/today')
  await h.wait(500)
  const before = await h.capture(full ? 'today' : 'today-reduced')

  // Free-running sample of the whole transition.
  await startSampler(page)
  await sidebarButton(page, 'Upcoming').click()
  await h.wait(900)
  const free = await readSampler(page)
  const running = free.samples.filter((s) => s.active)
  await h.assert(`${tag}: a page transition runs after a mouse click (type "page" active on several frames)`, { ok: running.length >= 3, detail: `${running.length} frames` })
  await h.assert(`${tag}: the content region is the one group that changes (content)`, {
    ok: running.some((s) => s.groups.includes('content')) && running.every((s) => s.groups.every((g) => g === 'content')),
    detail: JSON.stringify([...new Set(running.flatMap((s) => s.groups))]),
  })
  await h.assert(`${tag}: the root does not animate (the sidebar and title bar stay)`, { ok: !running.some((s) => s.groups.includes('root')), detail: 'no root group animation' })
  const travelling = free.samples.filter((x) => x.pillTransform && x.pillTransform !== 'none')
  await h.assert(
    full ? 'full motion: the sidebar pill slides (a transform on its element for several frames)' : 'reduced: the sidebar pill does not slide (no transform on any frame)',
    { ok: full ? travelling.length >= 3 : travelling.length === 0, detail: `${travelling.length} frames with a transform` },
  )
  const fading = running.filter((s) => s.newOpacity > 0.02 && s.newOpacity < 0.98)
  await h.assert(`${tag}: the new page fades in (opacity between 0 and 1 on at least 2 frames)`, { ok: fading.length >= 2, detail: `${fading.length} frames` })
  const rising = running.filter((s) => translateY(s.newTranslate) > 0.2)
  if (full) {
    await h.assert('full motion: the new page rises (a translate between 6 px and 0 on at least 2 frames, never beyond 6 px)', {
      ok: rising.length >= 2 && running.every((s) => translateY(s.newTranslate) <= 6.01),
      detail: `${rising.length} frames, max ${Math.max(...running.map((s) => translateY(s.newTranslate))).toFixed(1)} px`,
    })
    const out = running.filter((s) => s.oldOpacity < 0.98).length
    await h.assert('full motion: the old page fades out before the new one is full (old opacity below 1 on at least 1 frame)', { ok: out >= 1, detail: `${out} frames` })
  } else {
    await h.assert('reduced: a cross-fade only, no rise on any frame', { ok: running.every((s) => translateY(s.newTranslate) === 0), detail: `${running.length} frames` })
  }
  const settled = await leftovers(page)
  await h.assert(`${tag}: after the transition no name, type or attribute is left`, { ok: !settled.active && settled.mainName === 'none' && settled.pillAnimations === 0 && settled.taskNames === 0, detail: JSON.stringify(settled) })
  await h.assert(`${tag}: the view is Upcoming`, { ok: /upcoming/.test(settled.route), detail: settled.route })
  const after = await h.capture(full ? 'upcoming' : 'upcoming-reduced')
  const pill = await page.evaluate(() => {
    const el = document.querySelector('[data-sidebar-pill]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const b = el.parentElement.getBoundingClientRect()
    // The pill must be painted: a visible background, and behind the label (the topmost element at its centre is not the pill).
    return { w: r.width, same: Math.abs(r.left - b.left) < 1 && Math.abs(r.top - b.top) < 1 && Math.abs(r.width - b.width) < 1 && Math.abs(r.height - b.height) < 1, bg: getComputedStyle(el).backgroundColor, text: el.parentElement.textContent.trim().slice(0, 12) }
  })
  await h.assert(`${tag}: the sidebar pill sits behind the active item (same box, visible background)`, { ok: !!pill && pill.same && pill.w > 100 && pill.bg !== 'rgba(0, 0, 0, 0)' && /Upcoming/.test(pill.text), detail: JSON.stringify(pill) })

  // Frozen mid-frame: back to Today.
  await startSampler(page, { freeze: true, freezeAt: full ? 100 : 25 })
  await sidebarButton(page, 'Today').click()
  await h.wait(350)
  const frozen = (await readSampler(page)).frozen
  if (!frozen) {
    await h.assert(`${tag}: a mid-transition frame was frozen`, false)
  } else {
    const mid = await h.capture(full ? 'mid-transition' : 'mid-transition-reduced')
    await h.assert(`${tag}: mid-transition the new page is partly visible (opacity ${frozen.newOpacity.toFixed(2)})`, { ok: frozen.newOpacity > 0.02 && frozen.newOpacity < 0.98, detail: `old ${frozen.oldOpacity.toFixed(2)}, new ${frozen.newOpacity.toFixed(2)}, rise ${translateY(frozen.newTranslate).toFixed(1)} px` })
    if (full) await h.assert('full motion: mid-transition the rise is between 0 and 6 px', { ok: translateY(frozen.newTranslate) > 0.05 && translateY(frozen.newTranslate) < 6, detail: frozen.newTranslate })
    await h.assert(`${tag}: the mid-transition capture differs from the Upcoming and Today captures`, { ok: hash(mid) !== hash(after) && hash(mid) !== hash(before), detail: 'sha256' })
  }
  await release(page)
  await h.wait(800)
}

/** Keyboard navigation is instant: no transition, the new view is there at once. */
export async function keyboardSwitch(h, page) {
  await h.dismiss()
  await h.goto('/today')
  await h.wait(400)
  await sidebarButton(page, 'Anytime').focus()
  await startSampler(page)
  await h.key('Enter')
  await h.wait(150)
  const heading = await page.locator('h1').first().textContent()
  await h.wait(500)
  const s = await readSampler(page)
  await h.assert('keyboard: Enter on a sidebar item opens the view at once (heading is Anytime within 150 ms)', { ok: /Anytime/i.test(heading ?? ''), detail: heading })
  await h.assert('keyboard: no page transition ran (no frame with the type active or a pseudo-element animation)', { ok: s.samples.every((x) => !x.active && x.groups.length === 0), detail: `${s.samples.length} frames` })
  await h.capture('keyboard-anytime')

  // The mouse works again afterwards.
  await startSampler(page)
  await sidebarButton(page, 'Today').click()
  await h.wait(600)
  const again = await readSampler(page)
  await h.assert('keyboard: the sidebar pill moves instantly too (no transform on any frame)', { ok: s.samples.every((x) => !x.pillTransform || x.pillTransform === 'none'), detail: `${s.samples.length} frames` })
  await h.assert('keyboard: a mouse click after the keyboard animates again', { ok: again.samples.some((x) => x.active), detail: `${again.samples.filter((x) => x.active).length} frames` })
}
