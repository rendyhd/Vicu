// E4 (card 1.3, popover primitive): the pickers float in the top layer and stay on screen.
//
//   A. Schedule on the last Today row at 1280x820 and 900x600: inside the window, flipped above when
//      there is no room below, scrolling inside itself when the window is too short, Escape closes
//      it and focus returns to the Schedule button without collapsing the card.
//   B. Every picker of the open card (Schedule, Priority, Labels, Reminders, Attachments, Move to
//      project, Task info) opens and closes with the mouse (click, click again, press outside) and
//      the keyboard (Enter, Escape), keeps its role and name, and takes focus when it opens.
//   C. Repeat, nested in Schedule: Escape closes the inner panel first.
//   D. The label picker of the new-task composer.
//   E. The context menu: its Schedule picker opens beside the menu, Escape closes one layer.
//   F. A picker follows its button when the list scrolls.
//
// (Task info moved under More with card 3.3; the card-toolbar scenario covers it.)
// Written against behaviour only: the popover is found through the platform's own `popover`
// attribute and `:popover-open`, plus the role and the accessible name.
export const meta = {
  id: 'E4',
  wave: 1,
  title: 'Pickers stay on screen: Schedule on the last Today row at 1280x820 and 900x600, Escape and focus return, all nine pickers by mouse and keyboard',
}

const SIZES = [
  [1280, 820],
  [900, 600],
]

/** The pickers that sit in the toolbar of an open card. */
const CARD_PICKERS = [
  { key: 'date', title: 'Schedule', prop: 'schedule', role: 'dialog', label: 'Schedule' },
  { key: 'priority', title: 'Priority', prop: 'priority', role: 'listbox', label: 'Priority' },
  { key: 'labels', title: 'Labels', prop: 'labels', role: 'dialog', label: 'Labels' },
  { key: 'reminder', title: 'Reminders', prop: 'reminders', role: 'dialog', label: 'Reminders' },
  { key: 'attachment', title: 'Attachments', prop: 'attachments', role: 'dialog', label: 'Attachments' },
  { key: 'project', title: 'Move to project', prop: 'project', role: 'listbox', label: 'Move to project' },
]

/** Every open popover (box, scroll state, role, name, whether focus is inside) and the focused element. */
async function readState(page) {
  return page.evaluate(() => {
    const active = document.activeElement
    const popovers = [...document.querySelectorAll('[popover]:not([role="tooltip"])')]
      .filter((el) => el.matches(':popover-open'))
      .map((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return {
          role: el.getAttribute('role'),
          label: el.getAttribute('aria-label'),
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflowY: cs.overflowY,
          visibility: cs.visibility,
          placement: el.dataset.placement ?? null,
          hasFocus: !!active && el.contains(active),
        }
      })
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      popovers,
      active: active
        ? {
            tag: active.tagName.toLowerCase(),
            title: active.getAttribute('title') ?? ({ schedule: 'Schedule', priority: 'Priority', labels: 'Labels', reminders: 'Reminders', attachments: 'Attachments', project: 'Move to project' })[active.getAttribute('data-prop')] ?? null,
            name: active.getAttribute('aria-label') || active.textContent?.trim().slice(0, 24) || '',
            expanded: active.getAttribute('aria-expanded'),
          }
        : null,
    }
  })
}

const fmt = (p) => `${Math.round(p.x)},${Math.round(p.y)} to ${Math.round(p.right)},${Math.round(p.bottom)}`
const inside = (p, s) => p.x >= -0.5 && p.y >= -0.5 && p.right <= s.innerWidth + 0.5 && p.bottom <= s.innerHeight + 0.5

/** Resizes, shows Today and expands the last row; returns its task id. */
async function openLastCard(h, page, w, hgt) {
  await h.resize(w, hgt)
  await h.dismiss()
  await h.goto('/today')
  const row = h.lastRow()
  const id = await row.getAttribute('data-task-id')
  await row.scrollIntoViewIfNeeded()
  await row.click({ position: { x: 180, y: 12 } })
  await h.wait(700)
  return id
}

export default async function run(h) {
  const page = h.page

  for (const [w, hgt] of SIZES) {
    const tag = `${w}x${hgt}`

    // ---- A. Schedule on the last Today row -------------------------------------------------
    const id = await openLastCard(h, page, w, hgt)
    const trigger = page.locator(`[data-task-id="${id}"] button[data-prop="schedule"]`)
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    await h.wait(500)

    let state = await readState(page)
    const pop = state.popovers[0]
    await h.capture(`popover-${tag}`)
    const open = await h.assert(`${tag}: the Schedule popover opens`, state.popovers.length === 1)
    if (open) {
      const tb = await trigger.boundingBox()
      await h.assert(`${tag}: popover is inside the window`, {
        ok: inside(pop, state),
        detail: `box ${fmt(pop)} in ${state.innerWidth}x${state.innerHeight}`,
      })

      // Flipped above when it does not fit below the button; below otherwise.
      const spaceBelow = state.innerHeight - tb.y - tb.height
      const fitsBelow = spaceBelow >= pop.height + 6
      await h.assert(`${tag}: popover sits ${fitsBelow ? 'below' : 'above'} the button (${fitsBelow ? 'room below' : 'no room below'})`, {
        ok: fitsBelow ? pop.y >= tb.y + tb.height - 1 : pop.bottom <= tb.y + 1,
        detail: `button ${Math.round(tb.y)}-${Math.round(tb.y + tb.height)}, popover ${Math.round(pop.y)}-${Math.round(pop.bottom)}, space below ${Math.round(spaceBelow)}`,
      })

      await h.assert(`${tag}: the popover scrolls inside itself (overflow-y auto) and is no taller than the window`, {
        ok: ['auto', 'scroll'].includes(pop.overflowY) && pop.height <= state.innerHeight,
        detail: `height ${Math.round(pop.height)}, content ${pop.scrollHeight}, overflow-y ${pop.overflowY}`,
      })
      await h.assert(`${tag}: the Schedule button reports the open popover (aria-expanded)`, async () => (await trigger.getAttribute('aria-expanded')) === 'true')
      await h.assert(`${tag}: focus moved into the popover`, pop.hasFocus)

      // Content taller than any window: the popover is capped to the space and scrolls inside
      // itself (a spacer is added to the open popover, so the check does not depend on how tall
      // the real content happens to be).
      await page.evaluate(() => {
        const el = [...document.querySelectorAll('[popover]:not([role="tooltip"])')].find((x) => x.matches(':popover-open'))
        const spacer = document.createElement('div')
        spacer.setAttribute('data-test-spacer', '')
        spacer.style.height = '1400px'
        el.appendChild(spacer)
      })
      await h.wait(450)
      const tall = (await readState(page)).popovers[0]
      await h.capture(`popover-tall-${tag}`)
      await h.assert(`${tag}: oversize content: the popover stays inside the window`, {
        ok: inside(tall, state),
        detail: `box ${fmt(tall)} in ${state.innerWidth}x${state.innerHeight}`,
      })
      await h.assert(`${tag}: oversize content: the popover scrolls inside itself`, {
        ok: tall.scrollHeight > tall.clientHeight + 100 && ['auto', 'scroll'].includes(tall.overflowY),
        detail: `height ${Math.round(tall.height)}, content ${tall.scrollHeight}, overflow-y ${tall.overflowY}`,
      })
      const scrolled = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[popover]:not([role="tooltip"])')].find((x) => x.matches(':popover-open'))
        el.scrollTop = el.scrollHeight
        return el.scrollTop
      })
      await h.assert(`${tag}: oversize content: the popover can be scrolled to its end`, { ok: scrolled > 100, detail: `scrollTop ${Math.round(scrolled)}` })
      await page.evaluate(() => document.querySelector('[data-test-spacer]')?.remove())
      await h.wait(350)

      // Arrow keys and End move through the day grid (card 3.4a1).
      const cell = page.locator('[popover]:popover-open [role="grid"] button[tabindex="0"]')
      await cell.focus()
      const dateOf = () => page.evaluate(() => document.activeElement?.getAttribute('data-date') ?? null)
      const start = await dateOf()
      await h.key('ArrowRight')
      const next = await dateOf()
      await h.key('End')
      const end = await dateOf()
      await h.assert(`${tag}: ArrowRight and End move through the day grid`, {
        ok: !!start && !!next && !!end && next > start && end >= next && new Date(`${end}T12:00:00`).getDay() === 0,
        detail: `${start} -> ${next} -> ${end}`,
      })

      await h.key('Escape')
      await h.wait(350)
      state = await readState(page)
      await h.assert(`${tag}: Escape closes the popover`, state.popovers.length === 0)
      await h.assert(`${tag}: focus returns to the Schedule button`, {
        ok: state.active?.tag === 'button' && state.active?.title === 'Schedule',
        detail: JSON.stringify(state.active),
      })
      await h.assert(`${tag}: Escape closed the popover only, the card is still open`, async () => (await trigger.count()) === 1)
    } else {
      await h.key('Escape')
    }

    // ---- B. All pickers of the card, mouse and keyboard ------------------------------------
    for (const picker of CARD_PICKERS) {
      const t = `${tag} ${picker.key}`
      const btn = page.locator(`[data-task-id="${id}"] button[data-prop="${picker.prop}"]`).last()
      if ((await btn.count()) === 0) {
        await h.assert(`${t}: the toolbar button exists`, false)
        continue
      }
      await btn.scrollIntoViewIfNeeded()

      // Mouse: click opens.
      await btn.click()
      await h.wait(450)
      state = await readState(page)
      const p = state.popovers[0]
      const opened = await h.assert(`${t}: opens by mouse as a ${picker.role} named "${picker.label}"`, {
        ok: state.popovers.length === 1 && p.role === picker.role && p.label === picker.label,
        detail: JSON.stringify(state.popovers.map((x) => [x.role, x.label])),
      })
      if (!opened) {
        await h.key('Escape')
        await h.wait(250)
        continue
      }
      await h.assert(`${t}: inside the window`, { ok: inside(p, state), detail: `box ${fmt(p)} in ${state.innerWidth}x${state.innerHeight}` })
      await h.assert(`${t}: focus moved into the popover`, { ok: p.hasFocus, detail: JSON.stringify(state.active) })
      await h.assert(`${t}: the button reports it open`, async () => (await btn.getAttribute('aria-expanded')) === 'true')
      if (picker.key !== 'date') await h.capture(`${picker.key}-${tag}`)

      // Accessibility of the open popover: no serious axe violation other than colour contrast
      // (the colours belong to the token work), and the popover has a name.
      if (tag === '1280x820') {
        const found = await h.axe('[popover]:popover-open:not([role="tooltip"])', { label: `${picker.key} popover` })
        const serious = found.filter((v) => ['serious', 'critical'].includes(v.impact) && v.id !== 'color-contrast')
        await h.assert(`${t}: no serious axe violation (colour contrast aside)`, {
          ok: serious.length === 0,
          detail: serious.map((v) => `${v.id} ${v.targets[0] ?? ''}`).join('; '),
        })
      }

      // Listboxes: arrow keys move between the options.
      if (picker.role === 'listbox') {
        const before = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
        await h.key('ArrowDown')
        const after = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
        await h.assert(`${t}: ArrowDown moves to the next option`, { ok: before !== after && after !== '', detail: `${before} -> ${after}` })
      }

      // Mouse: clicking the button again closes it.
      await btn.click()
      await h.wait(350)
      state = await readState(page)
      await h.assert(`${t}: a second click on the button closes it`, state.popovers.length === 0)
      await h.assert(`${t}: the button reports it closed`, async () => (await btn.getAttribute('aria-expanded')) === 'false')

      // Mouse: a press outside (on the blank toolbar of the card) closes it.
      await btn.click()
      await h.wait(400)
      state = await readState(page)
      if (state.popovers.length === 1) {
        const card = await page.locator(`[data-task-id="${id}"]`).first().boundingBox()
        const tb = await btn.boundingBox()
        await page.mouse.click(card.x + 8, tb.y + tb.height / 2)
        await h.wait(350)
        state = await readState(page)
        await h.assert(`${t}: a press outside closes it`, state.popovers.length === 0)
      } else {
        await h.assert(`${t}: reopens by mouse`, false)
      }

      // Keyboard: Enter opens, Escape closes and focus returns to the button.
      await btn.focus()
      await h.key('Enter')
      await h.wait(450)
      state = await readState(page)
      await h.assert(`${t}: Enter on the button opens it and focus moves into it`, {
        ok: state.popovers.length === 1 && state.popovers[0].hasFocus,
        detail: `${state.popovers.length} open, ${JSON.stringify(state.active)}`,
      })
      // Opened from the keyboard, a button inside shows a focus ring (text fields show a caret).
      const ring = await page.evaluate(() => {
        const a = document.activeElement
        if (!a || a.tagName !== 'BUTTON') return null
        const cs = getComputedStyle(a)
        return { focusVisible: a.matches(':focus-visible'), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }
      })
      if (ring) {
        await h.assert(`${t}: the focused button shows a focus ring`, {
          ok: ring.focusVisible && ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0,
          detail: JSON.stringify(ring),
        })
      }
      await h.key('Escape')
      await h.wait(350)
      state = await readState(page)
      await h.assert(`${t}: Escape closes it`, state.popovers.length === 0)
      await h.assert(`${t}: focus returns to the button`, {
        ok: state.active?.tag === 'button' && state.active?.title === picker.title,
        detail: JSON.stringify(state.active),
      })
      await h.assert(`${t}: the card is still open`, async () => (await btn.count()) === 1)

      // Keyboard: Space opens as well.
      if (picker.key === 'priority') {
        await btn.focus()
        await h.key('Space')
        await h.wait(400)
        state = await readState(page)
        await h.assert(`${t}: Space on the button opens it`, state.popovers.length === 1)
        await h.key('Escape')
        await h.wait(300)
      }
    }

    // ---- C. Repeat, nested in Schedule -----------------------------------------------------
    {
      const t = `${tag} recurrence`
      const dateBtn = page.locator(`[data-task-id="${id}"] button[data-prop="schedule"]`)
      await dateBtn.scrollIntoViewIfNeeded()
      await dateBtn.click()
      await h.wait(450)
      const repeat = page.locator('[popover][aria-label="Schedule"] button[aria-haspopup="dialog"]').first()
      if ((await repeat.count()) === 0) {
        await h.assert(`${t}: the Repeat row exists in the Schedule popover`, false)
      } else {
        await repeat.click()
        await h.wait(450)
        state = await readState(page)
        const names = state.popovers.map((x) => x.label)
        await h.assert(`${t}: Repeat opens inside Schedule (both open)`, { ok: names.includes('Schedule') && names.includes('Repeat'), detail: names.join(', ') })
        const rep = state.popovers.find((x) => x.label === 'Repeat')
        if (rep) {
          await h.assert(`${t}: the Repeat panel is inside the window`, { ok: inside(rep, state), detail: `box ${fmt(rep)} in ${state.innerWidth}x${state.innerHeight}` })
          await h.assert(`${t}: focus moved into the Repeat panel`, rep.hasFocus)
          await h.capture(`recurrence-${tag}`)
        }
        await h.key('Escape')
        await h.wait(350)
        state = await readState(page)
        await h.assert(`${t}: Escape closes Repeat and leaves Schedule open`, {
          ok: state.popovers.length === 1 && state.popovers[0].label === 'Schedule',
          detail: state.popovers.map((x) => x.label).join(', '),
        })
        await h.assert(`${t}: focus returns to the Repeat row`, {
          ok: state.active?.tag === 'button' && state.active?.name.startsWith('Repeat'),
          detail: JSON.stringify(state.active),
        })
        await h.key('Escape')
        await h.wait(350)
        state = await readState(page)
        await h.assert(`${t}: a second Escape closes Schedule`, state.popovers.length === 0)
        await h.assert(`${t}: focus returns to the Schedule button`, {
          ok: state.active?.tag === 'button' && state.active?.title === 'Schedule',
          detail: JSON.stringify(state.active),
        })
      }
    }

    // ---- D. The label picker of the composer -----------------------------------------------
    {
      const t = `${tag} composer labels`
      await h.dismiss()
      await h.goto('/today')
      await page.locator('button[aria-label="New task"]').last().click()
      await h.wait(500)
      const btn = page.locator('button[title="Labels"]').first()
      await btn.click()
      await h.wait(450)
      state = await readState(page)
      const p = state.popovers[0]
      const opened = await h.assert(`${t}: opens by mouse as a dialog named "Labels"`, {
        ok: state.popovers.length === 1 && p.role === 'dialog' && p.label === 'Labels',
        detail: JSON.stringify(state.popovers.map((x) => [x.role, x.label])),
      })
      if (opened) {
        await h.assert(`${t}: inside the window`, { ok: inside(p, state), detail: `box ${fmt(p)}` })
        await h.assert(`${t}: the search field has focus`, {
          ok: p.hasFocus && state.active?.tag === 'input',
          detail: JSON.stringify(state.active),
        })
        await h.capture(`composer-labels-${tag}`)
        await h.key('Escape')
        await h.wait(350)
        state = await readState(page)
        await h.assert(`${t}: Escape closes it`, state.popovers.length === 0)
        await h.assert(`${t}: focus returns to the Labels button`, {
          ok: state.active?.tag === 'button' && state.active?.title === 'Labels',
          detail: JSON.stringify(state.active),
        })
        await h.assert(`${t}: the composer is still open`, async () => (await page.locator('button[title="Labels"]').count()) > 0)

        await btn.focus()
        await h.key('Enter')
        await h.wait(450)
        state = await readState(page)
        await h.assert(`${t}: Enter on the button opens it`, { ok: state.popovers.length === 1 && state.popovers[0].hasFocus, detail: JSON.stringify(state.active) })
        await btn.click()
        await h.wait(350)
        state = await readState(page)
        await h.assert(`${t}: a click on the button closes it`, state.popovers.length === 0)
      } else {
        await h.key('Escape')
      }
      await h.dismiss()
    }

    // ---- E. The context menu ---------------------------------------------------------------
    {
      const t = `${tag} context menu`
      await h.resize(w, hgt)
      await h.goto('/today')
      const row = h.lastRow()
      await row.scrollIntoViewIfNeeded()
      await row.click({ button: 'right', position: { x: 180, y: 12 } })
      await h.wait(500)
      const item = page.getByRole('menuitem', { name: /^Schedule…/ })
      if ((await item.count()) === 0) {
        await h.assert(`${t}: the menu opens`, false)
      } else {
        const menu = await item.evaluate((el) => {
          const m = el.closest('[role="menu"]')
          const r = m.getBoundingClientRect()
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
        })
        await item.click()
        await h.wait(450)
        state = await readState(page)
        const pickers = state.popovers.filter((x) => x.role !== 'menu') // the menu is a popover too
        const p = pickers[0]
        await h.assert(`${t}: Schedule opens as a popover`, pickers.length === 1 && p.label === 'Schedule')
        if (p) {
          await h.assert(`${t}: the popover is inside the window`, { ok: inside(p, state), detail: `box ${fmt(p)} in ${state.innerWidth}x${state.innerHeight}` })
          await h.assert(`${t}: the popover sits beside the menu, not over it`, {
            ok: p.x >= menu.right - 2 || p.right <= menu.x + 2,
            detail: `menu ${Math.round(menu.x)}-${Math.round(menu.right)}, popover ${Math.round(p.x)}-${Math.round(p.right)}`,
          })
          await h.capture(`context-schedule-${tag}`)

          // A press on another menu entry while the picker is open reaches that entry.
          await page.getByRole('menuitem', { name: /^Move to project…/ }).click()
          await h.wait(450)
          state = await readState(page)
          const others = state.popovers.filter((x) => x.role !== 'menu')
          await h.assert(`${t}: a press on another entry opens its picker and leaves the menu open`, {
            ok: others.length === 1 && others[0].label === 'Move to project' && state.popovers.some((x) => x.role === 'menu'),
            detail: state.popovers.map((x) => x.label).join(', '),
          })
          await h.key('Escape')
          await h.wait(350)
          state = await readState(page)
          await h.assert(`${t}: Escape closes the picker and leaves the menu`, async () => state.popovers.filter((x) => x.role !== 'menu').length === 0 && (await page.getByRole('menuitem', { name: /^Schedule…/ }).count()) === 1)
          await h.key('Escape')
          await h.wait(350)
          await h.assert(`${t}: a second Escape closes the menu`, async () => (await page.getByRole('menuitem', { name: /^Schedule…/ }).count()) === 0)
        }
      }
      await h.dismiss()
    }

    // ---- F. A picker follows its button when the list scrolls ------------------------------
    {
      const t = `${tag} scrolling`
      const sid = await openLastCard(h, page, w, hgt)
      const btn = page.locator(`[data-task-id="${sid}"] button[data-prop="schedule"]`)
      await btn.scrollIntoViewIfNeeded()
      await btn.click()
      await h.wait(450)
      const gap = async () => {
        const b = await btn.boundingBox()
        const s = await readState(page)
        const pp = s.popovers[0]
        if (!pp || !b) return null
        return { gap: pp.y >= b.y + b.height - 1 ? pp.y - (b.y + b.height) : b.y - pp.bottom, buttonY: b.y }
      }
      const before = await gap()
      // Wheel over the list, left of the popover, which scrolls the list and not the popover.
      await page.mouse.move(450, Math.round(hgt / 2))
      await page.mouse.wheel(0, -90)
      await h.wait(450)
      const after = await gap()
      if (!before || !after) {
        await h.assert(`${t}: the popover stays open while the list scrolls`, false)
      } else if (Math.abs(before.buttonY - after.buttonY) < 2) {
        h.emit({ t: 'skip', id: 'E4', message: `${t}: the list did not scroll at this size, nothing to follow` })
      } else {
        await h.assert(`${t}: the popover keeps its distance from the button after the list scrolled`, {
          ok: Math.abs(before.gap - after.gap) <= 2,
          detail: `button moved ${Math.round(after.buttonY - before.buttonY)} px, gap ${Math.round(before.gap)} -> ${Math.round(after.gap)}`,
        })
      }
      await h.key('Escape')
      await h.wait(300)
    }

    // ---- G. Ancestors with a transform or paint containment ---------------------------------
    // A dnd-kit row carries a transform while it moves, and a transform turns an ancestor into the
    // containing block of absolutely and fixed positioned children. The top layer ignores it.
    {
      const t = `${tag} transformed ancestors`
      const gid = await openLastCard(h, page, w, hgt)
      const btn = page.locator(`[data-task-id="${gid}"] button[data-prop="schedule"]`)
      await btn.scrollIntoViewIfNeeded()
      await page.evaluate((taskId) => {
        let el = document.querySelector(`[data-task-id="${taskId}"]`)
        while (el && el !== document.body) {
          el.dataset.testTransformed = '1'
          el.style.transform = 'translate3d(0px, 0px, 0px)'
          el.style.willChange = 'transform'
          el.style.contain = 'paint'
          el = el.parentElement
        }
      }, gid)
      await h.wait(200)
      await btn.click()
      await h.wait(450)
      const s = await readState(page)
      const p = s.popovers[0]
      const b = await btn.boundingBox()
      if (!p || !b) {
        await h.assert(`${t}: the popover opens`, false)
      } else {
        const gap = p.y >= b.y + b.height - 1 ? p.y - (b.y + b.height) : b.y - p.bottom
        await h.assert(`${t}: the popover is inside the window and 6 px from its button`, {
          ok: inside(p, s) && Math.abs(gap - 6) <= 2,
          detail: `box ${fmt(p)}, gap ${Math.round(gap)}`,
        })
      }
      await h.key('Escape')
      await h.wait(300)
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('[data-test-transformed]')) {
          el.style.transform = ''
          el.style.willChange = ''
          el.style.contain = ''
          delete el.dataset.testTransformed
        }
      })
    }
  }
}
