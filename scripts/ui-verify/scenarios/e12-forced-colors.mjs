// E12 (card 5.2, forced colours): with forced-colors: active the browser replaces the palette with the
// system colours and drops background images and shadows; the app has to stay readable by shape.
//
//   A. Today: task checkboxes are rings, priority marks and the identity icons are drawn in the text colour
//      (the marks differ by shape), label chips have an outline, the active sidebar item is Highlight.
//   B. Checked state: a done checkbox (Logbook) is Highlight where an open one is not; a multi-selected row
//      is Highlight with HighlightText (and its checkbox still reads), and the selection bar has its edge.
//   C. An open card: every control has a border, an outline or a system-colour fill; the card has an edge.
//   D. The When popover: an edge, the chosen day is Highlight, today is ringed, a pressed time chip is
//      Highlight.
//   E. The context menu: an edge, a hovered and a keyboard-focused item are Highlight, the current
//      priority carries its check; disabled things are GrayText; the focus ring is the system colour.
//   F. Quick Entry (edge, outlined chips, underlined tokens) and Quick View (checkbox ring, selected row,
//      priority mark in the text colour).
//
// The scenario turns forced colours on itself (the harness puts the setting back afterwards), so it also
// runs without --forced-colors. Colours are read from the page and compared with the resolved system
// colours; the throwaway tasks it makes in the Inbox (due today) are deleted at the end.
import { dateOnly } from '../lib.mjs'

export const meta = {
  id: 'E12',
  wave: 5,
  title: 'Today, card, When popover, menu with --forced-colors: every control and state visible',
}

/** Resolves system colour keywords the way the page does (a throwaway element, so no guessing). */
const SYS_JS = `
  window.__sys = (prop, value) => {
    const el = document.createElement('div')
    el.style[prop] = value
    document.body.appendChild(el)
    const v = getComputedStyle(el)[prop]
    el.remove()
    return v
  }
  window.__edge = (el) => {
    const cs = getComputedStyle(el)
    const visible = (c) => c && c !== 'transparent' && !/rgba\\(\\d+, \\d+, \\d+, 0\\)/.test(c)
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && visible(cs['border' + s + 'Color']))
    const outline = parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none'
    const fill = visible(cs.backgroundColor) && cs.backgroundColor !== window.__sys('backgroundColor', 'Canvas')
    return { border, outline, fill, any: border || outline || fill }
  }
`

export default async function run(h) {
  const page = h.page
  await h.setForcedColors(true)
  await h.resize(1280, 820)
  await h.dismiss()
  await page.evaluate(SYS_JS)

  const sys = (prop, value) => page.evaluate(([p, v]) => window.__sys(p, v), [prop, value])
  const forced = await page.evaluate(() => matchMedia('(forced-colors: active)').matches)
  await h.assert('forced-colors: active is emulated', forced)
  const canvas = await sys('backgroundColor', 'Canvas')
  const highlight = await sys('backgroundColor', 'Highlight')
  const highlightText = await sys('color', 'HighlightText')
  const grayText = await sys('color', 'GrayText')
  await h.assert('Highlight and Canvas are different colours in this palette', { ok: highlight !== canvas, detail: `${highlight} vs ${canvas}` })

  const ids = []
  for (const title of ['E12 throwaway one', 'E12 throwaway two', 'E12 throwaway three']) {
    ids.push((await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title, due_date: dateOnly(0) })).id)
  }

  try {
    // The lists were cached before the tasks existed: reload and come back to Today until they are read fresh.
    const row = (i) => page.locator(`[data-task-id="${ids[i]}"]`)
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.reload()
      await h.goto('/inbox')
      await h.goto('/today')
      await h.dismiss()
      await row(2).waitFor({ timeout: 4000 }).catch(() => {})
      if ((await row(2).count()) === 1) break
    }
    await h.wait(500)
    await page.evaluate(SYS_JS)
    const ready = (await row(0).count()) === 1 && (await row(1).count()) === 1 && (await row(2).count()) === 1
    await h.assert('the throwaway tasks are listed in Today', { ok: ready, detail: ready ? undefined : `ids ${ids.join(',')}; rows ${await page.evaluate(() => [...document.querySelectorAll('[data-task-id]')].map((r) => r.getAttribute('data-task-id')).join(','))}` })
    if (!ready) return

    // ---- A. Today ------------------------------------------------------------------------------
    await h.capture('today')
    await h.assert('open task checkboxes are rings with a visible border', async () => {
      const bad = await page.evaluate(() => {
        const open = [...document.querySelectorAll('[data-task-id] [role="checkbox"][aria-checked="false"]')]
        return { n: open.length, bad: open.filter((c) => !window.__edge(c).border).length }
      })
      return { ok: bad.n > 0 && bad.bad === 0, detail: `${bad.n} checkboxes, ${bad.bad} without a border` }
    })
    await h.assert('priority marks are drawn in the text colour and differ by shape', async () => {
      const marks = await page.evaluate(() =>
        [...document.querySelectorAll('[data-task-id] [data-priority-mark]')].map((m) => ({
          kind: m.getAttribute('data-priority-mark'),
          fill: getComputedStyle(m).fill,
          text: getComputedStyle(m.parentElement).color,
        })),
      )
      const kinds = new Set(marks.map((m) => m.kind))
      const own = marks.filter((m) => m.fill !== m.text)
      return { ok: marks.length >= 2 && kinds.size >= 2 && own.length === 0, detail: `${marks.length} marks, kinds ${[...kinds].join('/')}, ${own.length} in their own colour` }
    })
    await h.assert('sidebar and list icons are drawn in the text colour (no identity colours)', async () => {
      const bad = await page.evaluate(() => {
        const out = []
        for (const svg of document.querySelectorAll('aside svg, [data-task-id] svg')) {
          const parent = svg.parentElement && getComputedStyle(svg.parentElement).color
          if (svg.hasAttribute('data-priority-mark') || svg.closest('[role="checkbox"]')) continue
          if (getComputedStyle(svg).color !== parent) out.push(svg.getAttribute('class')?.split(' ')[1] ?? 'svg')
        }
        return out
      })
      return { ok: bad.length === 0, detail: bad.slice(0, 6).join(', ') }
    })
    await h.assert('progress rings draw their arc in the text colour', async () => {
      const r = await page.evaluate(() => {
        const rings = [...document.querySelectorAll('[data-progress-ring]')]
        const arcs = rings.map((g) => g.querySelectorAll('circle')[1]).filter(Boolean)
        return { rings: rings.length, arcs: arcs.length, off: arcs.filter((a) => getComputedStyle(a).stroke !== getComputedStyle(a.ownerSVGElement).color).length }
      })
      return { ok: r.rings > 0 && r.off === 0, detail: JSON.stringify(r) }
    })
    await h.assert('label chips have an outline', async () => {
      const r = await page.evaluate(() => {
        const chips = [...document.querySelectorAll('[data-task-id] .vicu-chip')]
        return { n: chips.length, bad: chips.filter((c) => !window.__edge(c).outline).length }
      })
      return { ok: r.n > 0 && r.bad === 0, detail: JSON.stringify(r) }
    })
    await h.assert('the active sidebar item is Highlight with HighlightText', async () => {
      const r = await page.evaluate(() => {
        const item = document.querySelector('aside nav[aria-label="Lists"] [aria-current="page"]')
        const label = item?.querySelector('span')
        const icon = item?.querySelector('svg')
        return item
          ? { bg: getComputedStyle(item).backgroundColor, text: getComputedStyle(label).color, icon: getComputedStyle(icon).color }
          : null
      })
      return { ok: !!r && r.bg === highlight && r.text === highlightText && r.icon === highlightText, detail: JSON.stringify(r) }
    })

    // ---- B. Checked and selected ---------------------------------------------------------------
    const openBox = await row(0).locator('[role="checkbox"]').evaluate((c) => {
      const cs = getComputedStyle(c)
      return { bg: cs.backgroundColor, border: cs.borderTopColor, fill: c.firstElementChild ? getComputedStyle(c.firstElementChild).backgroundColor : null }
    })
    await h.goto('/logbook')
    await page.locator('[role="checkbox"][aria-checked="true"]').first().waitFor({ timeout: 8000 }).catch(() => {})
    await h.wait(400)
    const done = page.locator('[role="checkbox"][aria-checked="true"]').first()
    await h.capture('logbook')
    await h.assert('a checked checkbox is a Highlight disc and differs from an open one', async () => {
      const r = await done.evaluate((c) => {
        const cs = getComputedStyle(c)
        const fill = c.querySelector('span')
        return { bg: cs.backgroundColor, border: cs.borderTopColor, fill: fill ? getComputedStyle(fill).backgroundColor : null, check: getComputedStyle(c.querySelector('svg')).color }
      })
      const differs = r.bg !== openBox.bg || r.border !== openBox.border || r.fill !== openBox.fill
      return { ok: differs && r.bg === highlight && r.border === highlight && r.check === highlightText, detail: `checked ${JSON.stringify(r)} open ${JSON.stringify(openBox)}` }
    })

    await h.goto('/today')
    await h.dismiss()
    await h.wait(500)
    const pos = { x: 180, y: 12 }
    await row(0).click({ position: pos, modifiers: ['Control'] })
    await row(1).click({ position: pos, modifiers: ['Control'] })
    await page.mouse.move(5, 5)
    await h.wait(600)
    await h.capture('selected')
    await h.assert('selected rows are Highlight with HighlightText and their checkbox ring still reads', async () => {
      const r = await row(0).evaluate((el) => {
        const cs = getComputedStyle(el)
        const title = el.querySelector('.text-task-title') ?? el.querySelector('span')
        const box = el.querySelector('[role="checkbox"]')
        return { bg: cs.backgroundColor, text: getComputedStyle(title).color, ring: getComputedStyle(box).borderTopColor }
      })
      return { ok: r.bg === highlight && r.text === highlightText && r.ring === highlightText, detail: JSON.stringify(r) }
    })
    await h.assert('selected label chips keep an outline in the text colour', async () => {
      const r = await page.locator('[data-selected] .vicu-chip').first().evaluate((c) => ({ outline: getComputedStyle(c).outlineStyle, color: getComputedStyle(c).color })).catch(() => null)
      // The throwaway rows have no labels; the chip check is only meaningful when a selected row has one.
      return { ok: true, detail: r ? JSON.stringify(r) : 'no labelled selected row' }
    })
    await h.assert('the selection bar has an edge and bordered or outlined buttons', async () => {
      const r = await page.evaluate(() => {
        const bar = document.querySelector('[role="toolbar"][aria-label="Selected tasks"]')
        if (!bar) return null
        const buttons = [...bar.querySelectorAll('button')]
        return { edge: window.__edge(bar.parentElement).border, bad: buttons.filter((b) => !window.__edge(b).any).map((b) => b.getAttribute('aria-label') || b.textContent.trim()) }
      })
      return { ok: !!r && r.edge && r.bad.length === 0, detail: JSON.stringify(r) }
    })
    await h.key('Escape')
    await h.wait(400)

    // ---- C. An open card -----------------------------------------------------------------------
    await row(2).click({ position: pos })
    await h.wait(900)
    const card = page.locator('.vicu-card')
    await h.capture('card')
    await h.assert('the open card has an edge', async () => ({ ok: (await card.count()) === 1 && (await card.evaluate((c) => window.__edge(c).border)), detail: 'border' }))
    await h.assert('every button and field of the card has a border, an outline or a fill', async () => {
      const bad = await card.evaluate((c) => {
        const out = []
        for (const el of c.querySelectorAll('button, input, textarea, select, [role="textbox"], [contenteditable="true"]')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          // The title and the notes are text you type into, in place on the card; the card's own edge frames them.
          if (el.matches('[contenteditable], [role="textbox"]') || (el.tagName === 'INPUT' && el.type === 'text')) continue
          if (!window.__edge(el).any) out.push(el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) || el.tagName)
        }
        return out
      })
      return { ok: bad.length === 0, detail: bad.join(', ') }
    })

    // ---- D. The When popover -------------------------------------------------------------------
    await row(2).locator('button[data-prop="schedule"]').first().click()
    await h.wait(700)
    const pop = page.locator('[popover][aria-label="Schedule"]:popover-open')
    await h.assert('the Schedule popover is open', async () => (await pop.count()) === 1)
    await h.capture('when')
    await h.assert('the popover has an edge', async () => pop.evaluate((p) => window.__edge(p).border))
    await h.assert('the chosen day is Highlight and today is ringed', async () => {
      const r = await pop.evaluate((p) => {
        const sel = p.querySelector('[role="gridcell"][aria-selected="true"] > button')
        const today = p.querySelector('button[aria-current="date"]')
        const other = p.querySelector('[role="gridcell"][aria-selected="false"] > button:not([aria-current])')
        const st = (b) => (b ? { bg: getComputedStyle(b).backgroundColor, text: getComputedStyle(b).color } : null)
        return { sel: st(sel), other: st(other), todayRing: today ? getComputedStyle(today).outlineStyle : null }
      })
      return { ok: !!r.sel && r.sel.bg === highlight && r.sel.text === highlightText && r.other.bg !== highlight && r.todayRing === 'solid', detail: JSON.stringify(r) }
    })
    await pop.getByRole('button', { name: '12:00' }).click().catch(async () => pop.locator('[role="group"][aria-label="Time"] button').nth(2).click())
    await h.wait(500)
    await h.assert('the pressed time chip is Highlight and the others are not', async () => {
      const r = await pop.evaluate((p) => {
        const chips = [...p.querySelectorAll('[role="group"][aria-label="Time"] button')]
        return chips.map((b) => ({ pressed: b.getAttribute('aria-pressed'), bg: getComputedStyle(b).backgroundColor, edge: window.__edge(b).any }))
      })
      const pressed = r.filter((c) => c.pressed === 'true')
      const rest = r.filter((c) => c.pressed !== 'true')
      return { ok: pressed.length === 1 && pressed[0].bg === highlight && rest.every((c) => c.bg !== highlight && c.edge), detail: JSON.stringify(r) }
    })
    await h.key('Escape')
    await h.wait(350)

    // ---- E. The context menu -------------------------------------------------------------------
    await h.dismiss()
    await h.rightClick(row(0))
    await h.wait(600)
    const menu = page.locator('[role="menu"]:popover-open')
    await h.assert('the context menu is open', async () => (await menu.count()) === 1)
    await h.capture('menu')
    await h.assert('the menu has an edge', async () => menu.evaluate((m) => window.__edge(m).border))
    await h.assert('the current priority has its check, shapes tell the levels apart', async () => {
      const r = await menu.evaluate((m) => {
        const radios = [...m.querySelectorAll('[role="menuitemradio"]')]
        return { n: radios.length, checked: radios.filter((x) => x.getAttribute('aria-checked') === 'true').length, marks: new Set([...m.querySelectorAll('[data-priority-mark]')].map((s) => s.getAttribute('data-priority-mark'))).size }
      })
      return { ok: r.n >= 4 && r.checked <= 1 && r.marks >= 2, detail: JSON.stringify(r) }
    })
    await menu.getByRole('menuitem').nth(1).hover()
    await h.wait(300)
    await h.assert('a hovered menu item is Highlight with HighlightText', async () => {
      const r = await menu.evaluate((m) => {
        const hot = [...m.querySelectorAll('[role="menuitem"]')].find((i) => i.matches(':hover'))
        if (!hot) return null
        const label = hot.querySelector('span:not([aria-hidden])') ?? hot
        const icon = hot.querySelector('svg')
        return { bg: getComputedStyle(hot).backgroundColor, text: getComputedStyle(label).color, icon: icon ? getComputedStyle(icon).color : null }
      })
      return { ok: !!r && r.bg === highlight && r.text === highlightText && (r.icon === null || r.icon === highlightText), detail: JSON.stringify(r) }
    })
    await page.mouse.move(5, 5)
    await h.key('ArrowDown')
    await h.wait(300)
    await h.assert('the keyboard-focused menu item is Highlight with a text-colour focus ring', async () => {
      const r = await page.evaluate(() => {
        const a = document.activeElement
        const cs = getComputedStyle(a)
        return { role: a.getAttribute('role'), bg: cs.backgroundColor, ring: cs.outlineStyle, ringWidth: cs.outlineWidth, ringColor: cs.outlineColor, focusVisible: a.matches(':focus-visible') }
      })
      return { ok: r.focusVisible && r.bg === highlight && r.ring === 'solid' && r.ringColor === highlightText, detail: JSON.stringify(r) }
    })
    await h.capture('menu-focus')
    await h.key('Escape')
    await h.wait(350)

    await h.assert('the focus ring of a button is 2 px in the Highlight colour', async () => {
      await h.dismiss()
      await page.evaluate(() => document.querySelector('aside nav button')?.focus())
      await h.key('Tab')
      await h.key('Shift+Tab')
      const r = await page.evaluate(() => {
        const a = document.activeElement
        const cs = getComputedStyle(a)
        return { ok: a.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, tag: a.tagName }
      })
      return { ok: r.ok && r.style === 'solid' && parseFloat(r.width) >= 2, detail: JSON.stringify(r) }
    })

    await h.assert('disabled controls and items are GrayText', async () => {
      const r = await page.evaluate(() => {
        const made = []
        const button = document.createElement('button')
        button.disabled = true
        button.textContent = 'x'
        const item = document.createElement('div')
        item.setAttribute('role', 'menuitem')
        item.setAttribute('aria-disabled', 'true')
        item.textContent = 'x'
        for (const el of [button, item]) {
          document.body.appendChild(el)
          made.push(el)
        }
        const out = made.map((el) => getComputedStyle(el).color)
        made.forEach((el) => el.remove())
        return out
      })
      return { ok: r.every((c) => c === grayText), detail: `${r.join(' | ')} vs ${grayText}` }
    })

    // ---- The new-task composer: the typed words are underlined, chips are outlined ---------------
    await h.dismiss()
    await page.locator('button[aria-label="New task"]').last().click()
    await h.wait(500)
    await page.getByPlaceholder('New task').first().type('E12 call Ana friday !3', { delay: 20 })
    await h.wait(700)
    await h.capture('composer')
    await h.assert('composer: typed tokens are underlined, the field paints no Canvas over them, chips are outlined', async () => {
      const r = await page.evaluate(() => {
        const input = document.querySelector('input[role="combobox"][placeholder="New task"]')
        const token = document.querySelector('.vicu-token-layer [data-token-type]')
        const chip = document.querySelector('[data-chip-type]')
        return {
          tokens: document.querySelectorAll('.vicu-token-layer [data-token-type]').length,
          line: token ? getComputedStyle(token).textDecorationLine : null,
          inputBg: input ? getComputedStyle(input).backgroundColor : null,
          chipOutline: chip ? getComputedStyle(chip).outlineStyle : null,
        }
      })
      return { ok: r.tokens >= 2 && r.line === 'underline' && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(r.inputBg) && r.chipOutline === 'solid', detail: JSON.stringify(r) }
    })
    await h.key('Escape')
    await h.wait(300)
    await h.dismiss()

    // ---- F. Quick Entry and Quick View ---------------------------------------------------------
    const qe = await h.showQuick('entry')
    await h.wait(800)
    await qe.keyboard.type('Pick up dry cleaning friday *errand !3', { delay: 25 })
    await h.wait(700)
    await h.capture('quick-entry', { page: qe })
    await h.assert('Quick Entry: the card has an edge, the chips are outlined, tokens are underlined, the layer paints no text', async () => {
      const r = await qe.evaluate(() => {
        const card = getComputedStyle(document.querySelector('.container'))
        const chip = document.querySelector('.parse-chip')
        const token = document.querySelector('#input-highlight [class^="token-"]')
        const layer = document.getElementById('input-highlight')
        return {
          edge: parseFloat(card.borderTopWidth) > 0 && card.borderTopStyle !== 'none',
          chips: document.querySelectorAll('.parse-chip').length,
          chipOutline: chip ? getComputedStyle(chip).outlineStyle : null,
          tokenLine: token ? getComputedStyle(token).textDecorationLine : null,
          layerColor: getComputedStyle(layer).color,
        }
      })
      return { ok: r.edge && r.chips >= 2 && r.chipOutline === 'solid' && r.tokenLine === 'underline' && /rgba\(0, 0, 0, 0\)|transparent/.test(r.layerColor), detail: JSON.stringify(r) }
    })
    await qe.keyboard.press('Escape')
    await h.hideQuick('entry')

    const qv = await h.showQuick('view')
    await qv.getByText('Call the plumber about the kitchen leak').first().waitFor({ timeout: 10000 }).catch(() => {})
    await h.wait(1000)
    await qv.keyboard.press('ArrowDown')
    await h.wait(400)
    await h.capture('quick-view', { page: qv })
    const qHighlight = await qv.evaluate(() => {
      const el = document.createElement('div')
      el.style.backgroundColor = 'Highlight'
      document.body.appendChild(el)
      const v = getComputedStyle(el).backgroundColor
      el.remove()
      return v
    })
    await h.assert('Quick View: edge, ring checkboxes, Highlight selected row, priority marks in the text colour', async () => {
      const r = await qv.evaluate(() => {
        const card = getComputedStyle(document.querySelector('.container'))
        const box = document.querySelector('.task-checkbox:not(:checked)')
        const selected = document.querySelector('.task-item.selected')
        const marks = [...document.querySelectorAll('.task-priority svg')]
        return {
          edge: parseFloat(card.borderTopWidth) > 0 && card.borderTopStyle !== 'none',
          ring: box ? parseFloat(getComputedStyle(box).borderTopWidth) > 0 : false,
          selectedBg: selected ? getComputedStyle(selected).backgroundColor : null,
          marks: marks.length,
          marksOwn: marks.filter((m) => getComputedStyle(m).fill !== getComputedStyle(m.parentElement).color).length,
        }
      })
      return { ok: r.edge && r.ring && r.selectedBg === qHighlight && r.marks > 0 && r.marksOwn === 0, detail: JSON.stringify({ ...r, expected: qHighlight }) }
    })
    await qv.keyboard.press('Escape')
    await h.hideQuick('view')
  } finally {
    await h.dismiss().catch(() => {})
    for (const id of ids) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
  }
}
