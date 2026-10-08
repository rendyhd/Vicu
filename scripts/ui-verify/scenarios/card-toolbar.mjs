// card-toolbar (card 3.3, D-3): the property bar and surface of an open task card.
//
//   A. A card with no properties shows quiet "+" buttons in the Android order (date, priority,
//      labels, checklist, reminder, repeat), the project as a chip, an attachment button and More.
//   B. A card with properties shows them as chips (no plus) and each chip opens its editor.
//   C. Tooltips: nothing at 250 ms, the tooltip at 600 ms with the name and the shortcut, in the top
//      layer, fading over fade.fast; it goes on a press, on leaving and on Escape.
//   D. More holds Task info and Delete task; Task info opens its popover and focus returns to More.
//   E. Surface: light keeps its shadow; dark has bg.card, no shadow and a 1 px white-at-8% edge.
export const meta = {
  id: 'CT',
  wave: 3,
  title: 'Open card: set properties are chips, unset ones "+" buttons, Info and Delete under More, tooltips after 400 ms, dark card without a shadow',
}

const ORDER = ['schedule', 'priority', 'labels', 'checklist', 'reminders', 'repeat', 'project', 'attachments', 'more']
const items = (res) => (Array.isArray(res) ? res : (res?.items ?? []))
const isSet = (t) => ({
  schedule: !!t.due_date && !t.due_date.startsWith('0001'),
  priority: (t.priority ?? 0) > 0,
  labels: (t.labels ?? []).length > 0,
  reminders: (t.reminders ?? []).length > 0,
  repeat: (t.repeat_after ?? 0) > 0 || (t.repeat_mode ?? 0) > 0,
})

/** What each bar button shows: its hook, whether it carries a plus, its box. */
const readBar = (page, id) =>
  page.evaluate((taskId) => {
    const card = document.querySelector(`[data-task-id="${taskId}"]`)
    return [...(card?.querySelectorAll('button[data-prop]') ?? [])].map((b) => {
      const r = b.getBoundingClientRect()
      return { prop: b.getAttribute('data-prop'), name: b.getAttribute('aria-label'), plus: !!b.querySelector('svg.lucide-plus'), w: r.width, h: r.height, text: b.textContent.trim() }
    })
  }, id)

const tooltip = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="tooltip"]')][0]
    if (!el) return null
    const cs = getComputedStyle(el)
    return { text: el.textContent.trim(), open: el.matches(':popover-open'), opacity: Number(cs.opacity), duration: cs.transitionDuration, property: cs.transitionProperty, pointerEvents: cs.pointerEvents }
  })

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  const theme = dark ? 'dark' : 'light'

  // Two open tasks of the seed: the one with the most properties and one with none.
  const tasks = items(await h.api('GET', `/tasks?per_page=500&filter=${encodeURIComponent('done = false')}`)).filter((t) => !t.done)
  const score = (t) => Object.values(isSet(t)).filter(Boolean).length
  const withProps = [...tasks].sort((a, b) => score(b) - score(a))[0]
  const without = tasks.find((t) => score(t) === 0 && !(t.related_tasks?.subtask ?? []).length && !(t.attachments ?? []).length && !(t.related_tasks?.parenttask ?? []).length)

  const open = async (task) => {
    await h.goto('/anytime')
    await h.dismiss()
    const row = page.locator(`[data-task-id="${task.id}"]`)
    if ((await row.count()) === 0) return false
    await row.scrollIntoViewIfNeeded()
    await row.click({ position: { x: 180, y: 12 } })
    await h.wait(700)
    return (await page.locator(`[data-task-id="${task.id}"] button[data-prop="schedule"]`).count()) > 0
  }

  // ---- A. No properties -------------------------------------------------------------------
  if (!without) {
    h.emit({ t: 'skip', id: meta.id, message: 'the seed has no open task without properties' })
  } else if (await open(without)) {
    const bar = await readBar(page, without.id)
    await h.assert('A: the bar has the buttons in the Android order', { ok: JSON.stringify(bar.map((b) => b.prop)) === JSON.stringify(ORDER), detail: bar.map((b) => b.prop).join(',') })
    const unset = ['schedule', 'priority', 'labels', 'checklist', 'reminders', 'repeat']
    await h.assert('A: every unset property is a quiet "+" button', { ok: unset.every((p) => bar.find((b) => b.prop === p)?.plus), detail: bar.map((b) => `${b.prop}${b.plus ? '+' : ''}`).join(' ') })
    await h.assert('A: the project is a chip with its name', { ok: !!bar.find((b) => b.prop === 'project' && !b.plus && b.text.length > 0), detail: bar.find((b) => b.prop === 'project')?.text })
    await h.assert('A: every button is at least 28 px high and 28 px wide', { ok: bar.every((b) => b.h >= 27.5 && b.w >= 27.5), detail: bar.filter((b) => b.h < 27.5 || b.w < 27.5).map((b) => `${b.prop} ${b.w}x${b.h}`).join(', ') })
    await h.capture(`card-without-properties-${theme}`, { clip: page.locator(`[data-task-id="${without.id}"]`) })
  } else {
    await h.assert('A: the task without properties opens as a card', false)
  }

  // ---- B. With properties -----------------------------------------------------------------
  if (!withProps || score(withProps) === 0) {
    h.emit({ t: 'skip', id: meta.id, message: 'the seed has no open task with properties' })
  } else if (await open(withProps)) {
    const bar = await readBar(page, withProps.id)
    const set = isSet(withProps)
    const hooks = { schedule: set.schedule, priority: set.priority, labels: set.labels, reminders: set.reminders, repeat: set.repeat }
    await h.assert('B: set properties are chips (no plus), unset ones keep the plus', {
      ok: Object.entries(hooks).every(([prop, on]) => bar.find((b) => b.prop === prop)?.plus === !on),
      detail: bar.map((b) => `${b.prop}${b.plus ? '+' : ''}`).join(' '),
    })
    await h.capture(`card-with-properties-${theme}`, { clip: page.locator(`[data-task-id="${withProps.id}"]`) })

    // Each chip opens its editor.
    for (const [prop, role, label] of [
      ['schedule', 'dialog', 'Schedule'],
      ['priority', 'listbox', 'Priority'],
      ['labels', 'dialog', 'Labels'],
      ['reminders', 'dialog', 'Reminders'],
      ['repeat', 'dialog', 'Repeat'],
    ]) {
      const btn = page.locator(`[data-task-id="${withProps.id}"] button[data-prop="${prop}"]`)
      await btn.click()
      await h.wait(450)
      const popover = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[popover]:popover-open')].find((e) => e.getAttribute('role') !== 'tooltip')
        return el ? { role: el.getAttribute('role'), label: el.getAttribute('aria-label') } : null
      })
      await h.assert(`B: the ${prop} button opens its ${role}`, { ok: popover?.role === role && (prop === 'repeat' ? true : popover?.label === label), detail: JSON.stringify(popover) })
      await h.key('Escape')
      await h.wait(300)
    }
  } else {
    await h.assert('B: the task with properties opens as a card', false)
  }

  // ---- C. Tooltips ------------------------------------------------------------------------
  const target = withProps ?? without
  if (target && (await page.locator(`[data-task-id="${target.id}"] button[data-prop="schedule"]`).count()) > 0) {
    const btn = page.locator(`[data-task-id="${target.id}"] button[data-prop="schedule"]`)
    await page.mouse.move(5, 5)
    await h.wait(200)
    await btn.hover()
    await h.wait(250)
    await h.assert('C: no tooltip after 250 ms', (await tooltip(page)) === null)
    await h.wait(350)
    const tip = await tooltip(page)
    await h.assert('C: the tooltip shows after about 400 ms with the name and the shortcut', { ok: !!tip && tip.open && /^Schedule/.test(tip.text) && /(Ctrl\+T|⌘T)/.test(tip.text), detail: JSON.stringify(tip) })
    await h.assert('C: it fades (opacity over fade.fast) and does not take the pointer', { ok: !!tip && /opacity/.test(tip.property) && tip.duration.split(', ').every((d) => d === '0.15s') && tip.pointerEvents === 'none' && tip.opacity > 0, detail: JSON.stringify(tip) })
    await h.capture(`tooltip-${theme}`, { clip: { x: 0, y: 0, width: 1280, height: 820 } })
    const described = await btn.getAttribute('aria-describedby')
    await h.assert('C: the button is described by the tooltip', !!described)
    await page.mouse.move(5, 5)
    await h.wait(400)
    await h.assert('C: leaving hides it', (await tooltip(page)) === null)

    await btn.hover()
    await h.wait(650)
    await h.assert('C: it shows again on the next rest', (await tooltip(page)) !== null)
    await page.mouse.down()
    await page.mouse.up()
    await h.wait(450)
    await h.assert('C: a press hides it (the Schedule popover opens)', (await tooltip(page)) === null)
    await h.key('Escape')
    await h.wait(300)

    // Keyboard focus shows it too.
    await page.mouse.move(5, 5)
    await btn.focus()
    await h.key('Shift+Tab')
    await h.key('Tab')
    await h.wait(650)
    await h.assert('C: keyboard focus shows it after the delay', (await tooltip(page)) !== null)
    await h.key('Escape')
    await h.wait(300)
    await h.assert('C: Escape hides it', (await tooltip(page)) === null)
    await h.assert('C: Escape on the tooltip did not close the card', (await btn.count()) === 1)
  }

  // ---- D. More -----------------------------------------------------------------------------
  if (target) {
    const more = page.locator(`[data-task-id="${target.id}"] button[data-prop="more"]`)
    await more.click()
    await h.wait(450)
    const menu = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[popover]:popover-open')].find((e) => e.getAttribute('role') === 'menu')
      return el ? { label: el.getAttribute('aria-label'), items: [...el.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim()) } : null
    })
    await h.assert('D: More opens a menu with Task info and Delete task', { ok: menu?.label === 'More' && JSON.stringify(menu.items) === JSON.stringify(['Task info', 'Delete task']), detail: JSON.stringify(menu) })
    await h.capture(`more-menu-${theme}`)
    await page.getByRole('menuitem', { name: 'Task info' }).click()
    await h.wait(450)
    const info = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[popover]:popover-open')].find((e) => e.getAttribute('role') !== 'tooltip')
      return el ? { role: el.getAttribute('role'), label: el.getAttribute('aria-label') } : null
    })
    await h.assert('D: Task info opens as a dialog named "Task info"', { ok: info?.role === 'dialog' && info?.label === 'Task info', detail: JSON.stringify(info) })
    await h.key('Escape')
    await h.wait(350)
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-prop') ?? null)
    await h.assert('D: Escape closes it and focus returns to More', { ok: focus === 'more', detail: focus })
    await h.assert('D: the card is still open', (await more.count()) === 1)

    // ---- E. Surface -----------------------------------------------------------------------
    const surface = await page.evaluate((id) => {
      const card = document.querySelector(`[data-task-id="${id}"]`)
      const cs = getComputedStyle(card)
      const probe = document.createElement('span')
      probe.style.color = 'var(--bg-card)'
      document.body.appendChild(probe)
      const bgCard = getComputedStyle(probe).color
      probe.remove()
      return { shadow: cs.boxShadow, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, bg: cs.backgroundColor, bgCard }
    }, target.id)
    if (dark) {
      await h.assert('E: the dark card has no shadow', { ok: surface.shadow === 'none' || !/rgba\((?!0, 0, 0, 0\))/.test(surface.shadow), detail: surface.shadow })
      await h.assert('E: the dark card has a 1 px white-at-8% edge', { ok: surface.borderWidth === '1px' && /rgba\(255, 255, 255, 0\.08\)|color\(srgb 1 1 1 \/ 0\.08\)/.test(surface.border), detail: `${surface.borderWidth} ${surface.border}` })
    } else {
      await h.assert('E: the light card keeps its shadow', { ok: surface.shadow !== 'none', detail: surface.shadow })
    }
    await h.assert('E: the card surface is bg.card', { ok: surface.bg === surface.bgCard, detail: `${surface.bg} vs ${surface.bgCard}` })
  }
  await h.dismiss()
}
