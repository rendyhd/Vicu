// keyboard-tab (card 1.5): focus ring, hit areas and the reduced-motion base layer.
//
//   A. Tab through Today with the real keyboard. Every stop shows the one focus ring (2 px solid
//      focus-ring, rows inset); a text field may draw its own focus state instead of the ring
//      only when it has no border of its own (borderless field inside a bar), and it is counted.
//   B. Hit areas: the checkbox is a 20 px circle with a 24 px hit area (elementFromPoint 11 px
//      from the centre returns the checkbox, 13 px does not); the collapsed-row attachment button
//      and subtask toggle are at least 24 px; the toolbar buttons of an open card are at least 28 px.
//   C. Reduced motion (--motion reduce emulation): no element transitions a transform, size or
//      position property, and no transition is longer than the fade.fast token (150 ms).
export const meta = {
  id: 'KT',
  wave: 1,
  title: 'Keyboard Tab through Today: focus ring on every stop; checkbox hit area; toolbar and row buttons large enough; reduced-motion base layer',
}

const MAX_STOPS = 150

/** What the focused element shows: ring, offset, kind. Marks it as seen; reports a repeat. */
async function readFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body || el === document.documentElement) return { body: true }
    const seen = (window.__ktSeen ??= new WeakSet())
    const repeat = seen.has(el)
    seen.add(el)
    const cs = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.color = 'var(--focus-ring)'
    document.body.appendChild(probe)
    const ringColour = getComputedStyle(probe).color
    probe.remove()
    const r = el.getBoundingClientRect()
    const tag = el.tagName.toLowerCase()
    const textField = tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) || el.isContentEditable
    return {
      repeat,
      tag,
      row: el.hasAttribute('data-task-id'),
      textField,
      bordered: parseFloat(cs.borderTopWidth) > 0,
      name: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth),
      outlineColor: cs.outlineColor,
      outlineOffset: parseFloat(cs.outlineOffset),
      ringColour,
      visible: r.width > 0 && r.height > 0,
    }
  })
}

const hasRing = (s) => s.focusVisible && s.outlineStyle === 'solid' && s.outlineWidth >= 2 && s.outlineColor === s.ringColour

export default async function run(h) {
  const page = h.page

  await h.resize(1280, 820)
  await h.dismiss()
  await h.goto('/today')

  // ---- A. Tab through Today ------------------------------------------------------------------
  await page.evaluate(() => {
    window.__ktSeen = new WeakSet()
  })
  await page.locator('h1').first().click({ position: { x: 4, y: 4 } })
  await h.wait(150)

  const stops = []
  for (let i = 0; i < MAX_STOPS; i++) {
    await h.key('Tab')
    await h.wait(40)
    const s = await readFocus(page)
    if (s.body || s.repeat) break
    stops.push(s)
  }

  await h.assert('Tab reaches the controls of Today (at least 10 stops)', { ok: stops.length >= 10, detail: `${stops.length} stops` })

  const exempt = stops.filter((s) => !hasRing(s) && s.textField && !s.bordered)
  const missing = stops.filter((s) => !hasRing(s) && !(s.textField && !s.bordered))
  await h.assert('every Tab stop in Today shows the focus ring (2 px solid, focus-ring colour)', {
    ok: missing.length === 0,
    detail: missing.map((s) => `${s.tag} "${s.name}" ${s.outlineStyle} ${s.outlineWidth}px ${s.outlineColor} vs ${s.ringColour} focusVisible=${s.focusVisible}`).join(' | '),
  })
  if (exempt.length > 0) {
    h.emit({ t: 'warn', id: 'KT', message: `${exempt.length} borderless text field(s) draw their own focus state: ${exempt.map((s) => s.name || s.tag).join(', ')}` })
  }

  const rowStops = stops.filter((s) => s.row)
  if (rowStops.length === 0) {
    h.emit({ t: 'skip', id: 'KT', message: 'no task row was a Tab stop in Today' })
  } else {
    await h.assert('a focused row draws its ring inside (offset -2 px)', {
      ok: rowStops.every((s) => s.outlineOffset === -2),
      detail: rowStops.map((s) => s.outlineOffset).join(', '),
    })
  }
  await h.assert('a button outside a row keeps the ring outside (offset 2 px)', async () => {
    const button = stops.find((s) => s.tag === 'button' && !s.row)
    return !!button && button.outlineOffset === 2
  })

  // The checkbox of the first row, focused from the keyboard.
  const firstCheckbox = page.locator('[data-task-id] button[role="checkbox"][aria-checked="false"]').first()
  await firstCheckbox.focus()
  await h.key('Shift+Tab')
  await h.key('Tab')
  await h.wait(100)
  const cb = await readFocus(page)
  await h.assert('the focused checkbox shows the ring', { ok: !cb.body && hasRing(cb), detail: JSON.stringify(cb) })
  await h.capture('checkbox-focus', { clip: page.locator('[data-task-id]').first() })
  await page.evaluate(() => document.activeElement?.blur())

  // ---- B. Hit areas --------------------------------------------------------------------------
  const box = await firstCheckbox.boundingBox()
  if (!box) {
    await h.assert('the first row has a checkbox', false)
  } else {
    await h.assert('the checkbox is a 20 px circle', {
      ok: Math.abs(box.width - 20) <= 0.5 && Math.abs(box.height - 20) <= 0.5,
      detail: `${box.width} x ${box.height}`,
    })
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const hit = (dx, dy) =>
      page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y)
          const button = el?.closest('button')
          return { isCheckbox: !!button && button.getAttribute('role') === 'checkbox', tag: el?.tagName ?? null }
        },
        [cx + dx, cy + dy],
      )
    for (const [dx, dy, where] of [[11, 0, 'right'], [-11, 0, 'left'], [0, 11, 'below'], [0, -11, 'above']]) {
      const r = await hit(dx, dy)
      await h.assert(`elementFromPoint 11 px ${where} of the checkbox centre returns the checkbox`, { ok: r.isCheckbox, detail: JSON.stringify(r) })
    }
    const outside = await hit(13, 0)
    await h.assert('elementFromPoint 13 px from the centre is outside the hit area', { ok: !outside.isCheckbox, detail: JSON.stringify(outside) })
  }

  // Collapsed-row buttons: the attachment paperclip and the subtask toggle, wherever the seed has them.
  await h.goto('/anytime')
  const small = await page.evaluate(() => {
    const out = []
    for (const row of document.querySelectorAll('[data-task-id]')) {
      for (const b of row.querySelectorAll('button')) {
        const label = b.getAttribute('aria-label') ?? ''
        const isAttachment = label === 'Attachments' && !b.getAttribute('title')
        const isSubtaskToggle = /subtasks complete$/.test(label)
        if (!isAttachment && !isSubtaskToggle) continue
        // The hit area is the button box plus any pseudo-element that extends it (inset, in px).
        const r = b.getBoundingClientRect()
        const after = getComputedStyle(b, '::after')
        const grow = after.position === 'absolute' ? [after.top, after.right, after.bottom, after.left].map(parseFloat) : [0, 0, 0, 0]
        const w = r.width - grow[1] - grow[3]
        const hgt = r.height - grow[0] - grow[2]
        out.push({ kind: isAttachment ? 'attachment' : 'subtask toggle', w, h: hgt })
      }
    }
    return out
  })
  for (const kind of ['attachment', 'subtask toggle']) {
    const found = small.filter((s) => s.kind === kind)
    if (found.length === 0) h.emit({ t: 'skip', id: 'KT', message: `no collapsed-row ${kind} button in the seed data` })
    else await h.assert(`the collapsed-row ${kind} button has a hit area of at least 24 x 24`, { ok: found.every((s) => s.w >= 24 - 0.5 && s.h >= 24 - 0.5), detail: found.map((s) => `${s.w}x${s.h}`).join(', ') })
  }

  // Toolbar buttons of an open card.
  await h.goto('/today')
  const row = h.rows().first()
  await row.click({ position: { x: 180, y: 12 } })
  await h.wait(700)
  const toolbar = await page.evaluate(() => {
    const card = document.querySelector('[data-task-id] button[data-prop="schedule"]')?.closest('[data-task-id]')
    if (!card) return null
    return [...card.querySelectorAll('button[data-prop]')].map((b) => {
      const r = b.getBoundingClientRect()
      return { title: b.getAttribute('data-prop'), w: r.width, h: r.height }
    })
  })
  if (!toolbar || toolbar.length === 0) {
    await h.assert('an open card shows its toolbar', false)
  } else {
    const tooSmall = toolbar.filter((b) => b.w < 28 - 0.5 || b.h < 28 - 0.5)
    await h.assert('every toolbar button of an open card is at least 28 x 28', {
      ok: tooSmall.length === 0,
      detail: tooSmall.map((b) => `${b.title} ${b.w}x${b.h}`).join(', ') || `${toolbar.length} buttons`,
    })
  }
  await h.dismiss()

  // ---- C. Reduced motion ---------------------------------------------------------------------
  await h.setMotion('reduce')
  await h.goto('/today')
  const motion = await page.evaluate(() => {
    const unmoved = ['transform', 'all', 'width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'translate', 'scale', 'rotate']
    const bad = []
    let longest = 0
    let sampled = 0
    for (const el of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo)
        const props = cs.transitionProperty.split(',').map((x) => x.trim())
        const durs = cs.transitionDuration.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000))
        sampled++
        for (const p of props) if (unmoved.includes(p)) bad.push(`${el.tagName.toLowerCase()}${pseudo ?? ''}: ${p}`)
        longest = Math.max(longest, ...durs)
      }
    }
    return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, bad: bad.slice(0, 5), longest, sampled }
  })
  await h.assert('the reduced-motion emulation is on', motion.reduced)
  await h.assert('under reduced motion no element transitions a transform, size or position property', { ok: motion.bad.length === 0, detail: motion.bad.join('; ') })
  await h.assert('under reduced motion no transition is longer than fade.fast (150 ms)', { ok: motion.longest <= 150, detail: `longest ${motion.longest} ms over ${motion.sampled} samples` })
  await h.setMotion('full')
}
