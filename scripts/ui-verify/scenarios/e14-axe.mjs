// E14 (card 3.1 starts it): axe-core on each surface. Serious and critical violations fail the run;
// minor and moderate ones are listed as `axe` lines. Later cards add their own surfaces to `SURFACES`
// (the When popover and each Settings tab are in).
export const meta = {
  id: 'E14',
  wave: 3,
  title: 'axe on Today, Upcoming, open card, When popover, each Settings section: no serious or critical violations',
}

const SETTINGS_SECTIONS = ['General', 'Projects', 'Quick Entry / View', 'Notifications', 'Keyboard Shortcuts']

const blocking = (violations) => violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
const LANDMARK_RULES = ['landmark-one-main', 'landmark-unique', 'region']
const describe = (violations) => violations.map((v) => `${v.id} (${v.impact}, ${v.nodes}): ${v.targets.join(' | ')}`).join('; ')

export default async function run(h) {
  await h.resize(1280, 820)

  const SURFACES = [
    {
      name: 'Today',
      open: async () => {
        await h.goto('/today')
        await h.dismiss()
      },
    },
    {
      name: 'Upcoming',
      open: async () => {
        await h.goto('/upcoming')
        await h.dismiss()
      },
    },
    {
      name: 'open card',
      open: async () => {
        await h.goto('/today')
        await h.dismiss()
        await h.rows().first().click({ position: { x: 180, y: 12 } })
        await h.wait(700)
      },
      ready: () => h.page.evaluate(() => !!document.querySelector('[data-task-id] button[data-prop="schedule"]')),
    },
    {
      // The When popover, opened from the schedule button of the last Today row (as the baseline does).
      name: 'When popover',
      open: async () => {
        await h.goto('/today')
        await h.dismiss()
        const last = h.lastRow()
        const taskId = await last.getAttribute('data-task-id')
        await last.click({ position: { x: 180, y: 12 } })
        await h.wait(700)
        await h.click(`[data-task-id="${taskId}"] button[data-prop="schedule"]`)
        await h.wait(600)
      },
      ready: () => h.page.evaluate(() => !!document.querySelector('[popover]:popover-open')),
    },
    // Settings, one surface per tab (nothing is changed, the tabs are only read).
    ...SETTINGS_SECTIONS.map((section) => ({
      name: `Settings: ${section}`,
      open: async () => {
        // Not dismissed after the goto: Escape leaves Settings (it goes back), so close what is open first.
        await h.dismiss()
        await h.goto('/settings')
        await h.page.getByRole('button', { name: section, exact: true }).click()
        await h.wait(600)
      },
      ready: () => h.page.getByRole('button', { name: section, exact: true }).evaluate((b) => b.className.includes('border-b-2')),
    })),
  ]

  for (const surface of SURFACES) {
    await surface.open()
    if (surface.ready) await h.assert(`${surface.name}: the surface is open`, await surface.ready())
    await h.capture(`axe-${surface.name.replace(/\s+/g, '-').toLowerCase()}`)
    const violations = await h.axe(undefined, { label: surface.name })
    const bad = blocking(violations)
    await h.assert(`${surface.name}: no serious or critical axe violations`, { ok: bad.length === 0, detail: describe(bad) })
    const landmarks = violations.filter((v) => LANDMARK_RULES.includes(v.id))
    await h.assert(`${surface.name}: one main landmark, unique labelled landmarks, no content outside them`, { ok: landmarks.length === 0, detail: describe(landmarks) })
    await h.dismiss()
  }

  // Windows 11 Mica: the sidebar is translucent over the native material, which follows the app theme
  // (nativeTheme.themeSource), so the page background colour stands in for it. The harness strips
  // data-material (capturePage and axe cannot see Mica); here it is put back for one measurement.
  await h.goto('/today')
  await h.dismiss()
  const mica = await h.page.evaluate(() => {
    window.__vicuKeepMaterial = true
    const root = document.documentElement
    root.dataset.material = 'mica'
    if (root.dataset.platform !== 'win32') throw new Error('Mica applies on Windows only')
    try {
      const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number)
      const lum = ([r, g, b]) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      const el = document.querySelector('nav .text-left.flex-1')
      const backdrop = parse(getComputedStyle(document.body).getPropertyValue('--bg-primary-rgb'))
      const text = parse(getComputedStyle(el).color)
      let bg = null
      for (let n = el; n && !bg; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c.length >= 3 && (c[3] ?? 1) > 0) bg = c
      }
      const a = bg ? (bg[3] ?? 1) : 0
      const flat = bg ? [0, 1, 2].map((i) => bg[i] * a + backdrop[i] * (1 - a)) : backdrop
      const [l1, l2] = [lum(text), lum(flat)].sort((x, y) => y - x)
      return { ratio: (l1 + 0.05) / (l2 + 0.05), text, bg, backdrop }
    } finally {
      window.__vicuKeepMaterial = false
      delete root.dataset.material
    }
  })
  await h.assert('Mica: sidebar text on the translucent sidebar over the theme backdrop has contrast of at least 4.5', { ok: mica.ratio >= 4.5, detail: JSON.stringify(mica) })

  // Row, checkbox and list semantics (card 3.1).
  await h.goto('/today')
  await h.dismiss()
  const semantics = await h.page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-task-id]')]
    const checkbox = rows[0]?.querySelector('[role="checkbox"]')
    return {
      rows: rows.length,
      allItems: rows.every((r) => r.getAttribute('role') === 'listitem' && r.closest('[role="list"]')),
      noButtonRows: rows.every((r) => !r.matches('[role="button"]') && r.getAttribute('aria-pressed') === null),
      checkboxTag: checkbox?.tagName,
      checked: checkbox?.getAttribute('aria-checked'),
      name: checkbox?.getAttribute('aria-label'),
      title: rows[0]?.querySelector('.text-task-title')?.textContent?.trim(),
    }
  })
  await h.assert('every row is a listitem inside a list and not a button', { ok: semantics.rows > 0 && semantics.allItems && semantics.noButtonRows, detail: JSON.stringify(semantics) })
  await h.assert('the checkbox has role, state and the name "Complete <title>"', {
    ok: semantics.checked === 'false' && semantics.name === `Complete ${semantics.title}`,
    detail: `${semantics.checkboxTag} ${semantics.checked} "${semantics.name}" vs "${semantics.title}"`,
  })

  // Roving tabindex: arrow keys move the keyboard selection and DOM focus with it; one row is a Tab
  // stop. Today, Upcoming and Anytime hand their rows over as children, a project has its own tasks.
  for (const route of ['/today', '/upcoming', '/anytime', '/inbox']) {
    await h.goto(route)
    await h.dismiss()
    await h.page.locator('h1').first().click({ position: { x: 4, y: 4 } })
    await h.key('ArrowDown')
    await h.key('ArrowDown')
    await h.wait(150)
    const roving = await h.page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-task-id]')]
      return {
        rows: rows.length,
        stops: rows.filter((r) => r.tabIndex === 0).length,
        focusedIndex: rows.indexOf(document.activeElement),
      }
    })
    await h.assert(`${route}: two ArrowDown presses focus the second row; it is the only row Tab stop`, { ok: roving.rows >= 2 && roving.focusedIndex === 1 && roving.stops === 1, detail: JSON.stringify(roving) })
    await h.key('ArrowUp')
    await h.wait(100)
    const up = await h.page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].indexOf(document.activeElement))
    await h.assert(`${route}: ArrowUp moves back to the first row`, { ok: up === 0, detail: up })
  }

  // Subtask checkboxes of an open card carry role, state and name too.
  await h.goto('/anytime')
  await h.dismiss()
  const parent = h.page.locator('[data-task-id]:has(button[aria-label$="subtasks complete"])').first()
  if ((await parent.count()) === 0) {
    h.emit({ t: 'skip', id: meta.id, message: 'no task with subtasks in the seed' })
  } else {
    await parent.click({ position: { x: 180, y: 12 } })
    await h.wait(900)
    const subs = await h.page.evaluate(() => {
      const card = document.querySelector('[data-task-id] button[data-prop="schedule"]')?.closest('[data-task-id]')
      return [...(card?.querySelectorAll('[role="checkbox"]') ?? [])].slice(1).map((b) => ({ checked: b.getAttribute('aria-checked'), name: b.getAttribute('aria-label') }))
    })
    await h.assert('every subtask checkbox of the card has aria-checked and a "Complete <title>" name', {
      ok: subs.length > 0 && subs.every((b) => (b.checked === 'true' || b.checked === 'false') && /^Complete .+/.test(b.name ?? '')),
      detail: JSON.stringify(subs),
    })
    const violations = await h.axe(undefined, { label: 'card with subtasks' })
    await h.assert('card with subtasks: no serious or critical axe violations', { ok: blocking(violations).length === 0, detail: describe(blocking(violations)) })
    await h.dismiss()
  }
}
