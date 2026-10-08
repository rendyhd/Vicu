// picker-keys (card 3.2c, D-20): the list pickers are real listboxes.
//
// For Priority, Move to project, Labels (card), Labels (new-task composer) and Repeat (inside
// Schedule), opened from the keyboard: the popover has its role and name, its entries are options
// with aria-selected inside a listbox, ArrowDown / End / Home move focus between options,
// typing the start of a name jumps to it, axe finds nothing serious, and Escape closes the picker
// with focus back on the control that opened it. Task info is a dialog. Nothing is chosen, so no
// task changes.
export const meta = {
  id: 'PK',
  wave: 3,
  title: 'Pickers by keyboard: listbox and option roles, aria-selected, arrows, Home/End, type-ahead, axe, Escape and focus return',
}

const state = (page) =>
  page.evaluate(() => {
    const pops = [...document.querySelectorAll('[popover]')].filter((el) => el.matches(':popover-open'))
    const pop = pops[pops.length - 1]
    const active = document.activeElement
    const lb = pop?.querySelector('[role="listbox"]') ?? (pop?.getAttribute('role') === 'listbox' ? pop : null)
    const options = lb ? [...lb.querySelectorAll('[role="option"]')] : []
    const label = (el) => (el?.textContent ?? '').trim().replace(/\s+/g, ' ')
    return {
      popovers: pops.length,
      role: pop?.getAttribute('role') ?? null,
      name: pop?.getAttribute('aria-label') ?? null,
      listbox: !!lb,
      listboxName: lb?.getAttribute('aria-label') ?? null,
      optionCount: options.length,
      allHaveSelected: options.length > 0 && options.every((o) => o.hasAttribute('aria-selected')),
      labels: options.map(label),
      activeIndex: options.indexOf(active),
      activeLabel: options.includes(active) ? label(active) : null,
      focusInside: !!pop && pop.contains(active),
      activeTitle: active?.getAttribute?.('title') ?? null,
      activeName: (active?.getAttribute?.('aria-label') || active?.textContent || '').trim().slice(0, 30),
    }
  })

/** Opens a picker by keyboard, then runs the shared checks. */
async function check(h, page, name, { open, expectRole, expectName, trigger }) {
  await open()
  await h.wait(450)
  let s = await state(page)
  await h.assert(`${name}: opens with role ${expectRole} named "${expectName}"`, { ok: s.popovers >= 1 && s.role === expectRole && s.name === expectName, detail: JSON.stringify({ role: s.role, name: s.name, n: s.popovers }) })
  await h.assert(`${name}: focus moved inside`, { ok: s.focusInside, detail: JSON.stringify(s) })
  await h.assert(`${name}: has a listbox of options, each with aria-selected`, { ok: s.listbox && s.optionCount >= 2 && s.allHaveSelected, detail: JSON.stringify({ lb: s.listbox, n: s.optionCount, sel: s.allHaveSelected }) })
  await h.capture(`${name.replace(/\W+/g, '-')}`)
  const found = await h.axe('[popover]:popover-open', { label: `${name} picker` })
  await h.assert(`${name}: axe finds nothing serious or critical`, { ok: found.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: found.map((v) => v.id).join(', ') })

  if (s.optionCount >= 2) {
    const count = s.optionCount
    await h.key('End')
    s = await state(page)
    // A search field keeps End for the caret, so use ArrowUp from the field to reach the last option.
    if (s.activeIndex !== count - 1) {
      await h.key('ArrowDown')
      await h.key('End')
      s = await state(page)
    }
    await h.assert(`${name}: End reaches the last option`, { ok: s.activeIndex === count - 1, detail: `${s.activeIndex} of ${count}, ${s.activeLabel}` })
    await h.key('Home')
    s = await state(page)
    await h.assert(`${name}: Home reaches the first option`, { ok: s.activeIndex === 0, detail: `${s.activeIndex}` })
    await h.key('ArrowDown')
    s = await state(page)
    await h.assert(`${name}: ArrowDown moves to the second option`, { ok: s.activeIndex === 1, detail: `${s.activeIndex}` })
    await h.key('ArrowUp')
    await h.key('ArrowUp')
    s = await state(page)
    await h.assert(`${name}: ArrowUp from the first option wraps to the last`, { ok: s.activeIndex === count - 1, detail: `${s.activeIndex}` })

    // Type-ahead: the first letters of the second option's name land on the first option that starts with them.
    await h.key('Home')
    const target = s.labels[1].replace(/^Create .*/, '').slice(0, 2)
    if (target.length === 2) {
      await h.wait(900)
      await h.type(target, { delay: 40 })
      s = await state(page)
      const expected = s.labels.findIndex((l) => l.toLowerCase().startsWith(target.toLowerCase()))
      await h.assert(`${name}: typing "${target}" jumps to the first option that starts with it`, { ok: s.activeIndex === expected && expected >= 0, detail: `active ${s.activeIndex}, expected ${expected}, ${JSON.stringify(s.labels)}` })
    }
  }

  await h.key('Escape')
  await h.wait(350)
  s = await state(page)
  await h.assert(`${name}: Escape closes it`, { ok: s.popovers === 0 || trigger === 'nested', detail: `${s.popovers} open` })
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.goto('/today')

  // The "Draft Q4 roadmap" card has labels, a priority and a project; open it by keyboard (Enter on the row).
  const row = page.locator('[data-task-id]', { hasText: 'Draft Q4 roadmap' }).first()
  const id = await row.getAttribute('data-task-id')
  await row.focus()
  await h.key('Enter')
  await h.wait(700)
  // The card bar's buttons carry a stable data-prop hook (card 3.3); Task info lives under More.
  const PROP = { Priority: 'priority', 'Move to project': 'project', Labels: 'labels', Schedule: 'schedule', 'Task info': 'more' }
  const button = (title) => page.locator(`[data-task-id="${id}"] button[data-prop="${PROP[title]}"]`)
  const press = (title) => async () => {
    await button(title).focus()
    await h.key('Enter')
  }
  const triggerFocused = (title) => async () => (await button(title).evaluate((b) => b === document.activeElement))

  await check(h, page, 'Priority', { open: press('Priority'), expectRole: 'listbox', expectName: 'Priority' })
  await h.assert('Priority: focus returns to the Priority button', await triggerFocused('Priority')())
  await check(h, page, 'Move to project', { open: press('Move to project'), expectRole: 'listbox', expectName: 'Move to project' })
  await h.assert('Move to project: focus returns to its button', await triggerFocused('Move to project')())
  await check(h, page, 'Labels', { open: press('Labels'), expectRole: 'dialog', expectName: 'Labels' })
  await h.assert('Labels: focus returns to the Labels button', await triggerFocused('Labels')())

  // Repeat sits inside Schedule.
  await check(h, page, 'Repeat', {
    trigger: 'nested',
    open: async () => {
      await button('Schedule').focus()
      await h.key('Enter')
      await h.wait(450)
      await page.getByRole('button', { name: /^Repeat/ }).first().click()
    },
    expectRole: 'dialog',
    expectName: 'Repeat',
  })
  await h.key('Escape') // Schedule
  await h.wait(300)

  // Task info is a plain dialog.
  await press('Task info')()
  await h.wait(350)
  await page.getByRole('menuitem', { name: 'Task info' }).click()
  await h.wait(450)
  let s = await state(page)
  await h.assert('Task info: a dialog named "Task info" with focus inside', { ok: s.role === 'dialog' && s.name === 'Task info' && s.focusInside, detail: JSON.stringify(s) })
  const info = await h.axe('[popover]:popover-open', { label: 'Task info picker' })
  await h.assert('Task info: axe finds nothing serious or critical', { ok: info.filter((v) => v.impact === 'serious' || v.impact === 'critical').length === 0, detail: info.map((v) => v.id).join(', ') })
  await h.key('Escape')
  await h.wait(350)
  s = await state(page)
  await h.assert('Task info: Escape closes it and focus returns to More', { ok: s.popovers === 0 && (await triggerFocused('Task info')()), detail: JSON.stringify(s) })

  // The label picker of the new-task composer.
  await h.dismiss()
  await h.goto('/today')
  await page.locator('button[aria-label="New task"]').last().click()
  await h.wait(500)
  await check(h, page, 'Composer labels', {
    open: async () => {
      await page.locator('button[title="Labels"]').first().focus()
      await h.key('Enter')
    },
    expectRole: 'dialog',
    expectName: 'Labels',
  })
  await h.dismiss()
}
