// E14 (card 3.1 starts it): axe-core on each surface. Serious and critical violations fail the run;
// minor and moderate ones are listed as `axe` lines. Later cards add their own surfaces (When
// popover, context menu, Settings) to `SURFACES`.
export const meta = {
  id: 'E14',
  wave: 3,
  title: 'axe on Today, Upcoming, open card, When popover, context menu, Settings: no serious or critical violations',
}

const blocking = (violations) => violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
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
      ready: () => h.page.evaluate(() => !!document.querySelector('[data-task-id] button[title="Schedule"]')),
    },
  ]

  for (const surface of SURFACES) {
    await surface.open()
    if (surface.ready) await h.assert(`${surface.name}: the surface is open`, await surface.ready())
    await h.capture(`axe-${surface.name.replace(/\s+/g, '-').toLowerCase()}`)
    const violations = await h.axe(undefined, { label: surface.name })
    const bad = blocking(violations)
    await h.assert(`${surface.name}: no serious or critical axe violations`, { ok: bad.length === 0, detail: describe(bad) })
    await h.dismiss()
  }

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

  // Roving tabindex: arrow keys move the keyboard selection and DOM focus with it; one row is a Tab stop.
  // (Today passes its rows as children, so only a list with its own tasks handles the arrows.)
  await h.goto('/inbox')
  await h.dismiss()
  await h.page.locator('h1').first().click({ position: { x: 4, y: 4 } })
  await h.key('ArrowDown')
  await h.key('ArrowDown')
  await h.wait(150)
  const roving = await h.page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-task-id]')]
    return {
      stops: rows.filter((r) => r.tabIndex === 0).length,
      focusedIndex: rows.indexOf(document.activeElement),
    }
  })
  await h.assert('two ArrowDown presses focus the second row; it is the only row Tab stop', { ok: roving.focusedIndex === 1 && roving.stops === 1, detail: JSON.stringify(roving) })
}
