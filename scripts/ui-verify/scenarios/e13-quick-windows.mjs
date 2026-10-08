// E13: Quick Entry with parsed text, and the Quick View list.
// Wave 1: the highlights sit exactly under the typed text and each token type has its own colour.
// From wave 2: circle checkboxes and priority marks in Quick View (not implemented yet).
export const meta = {
  id: 'E13',
  wave: 1,
  title: 'Quick Entry with parsed text, Quick View list: highlights aligned, role colours (wave 1); circle checkboxes and priority marks (from wave 2)',
}

const TYPED = 'Pick up dry cleaning friday *errand !3'

/**
 * Where each highlighted token is drawn versus where the input draws the same text. The expected
 * position is measured with the input's own font, so a highlight layer with another font, size,
 * padding or letter spacing shows up as an offset.
 */
async function measureHighlights(qe) {
  return qe.evaluate(() => {
    const input = document.getElementById('task-input')
    const layer = document.getElementById('input-highlight')
    const cs = getComputedStyle(input)
    const ctx = document.createElement('canvas').getContext('2d')
    // The font shorthand is empty under forced colors, so it is built from its parts.
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    ctx.font = font
    if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing
    const base = input.getBoundingClientRect().x + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) - input.scrollLeft
    const value = input.value
    const tokens = [...layer.querySelectorAll('span')].map((s) => {
      const text = s.textContent.replace(/\u00a0/g, ' ')
      const start = value.indexOf(text)
      const box = s.getBoundingClientRect()
      const bg = getComputedStyle(s).backgroundColor
      const color = getComputedStyle(s).color
      return {
        text,
        found: start >= 0,
        expectedX: base + ctx.measureText(value.slice(0, Math.max(start, 0))).width,
        expectedW: ctx.measureText(text).width,
        x: box.x,
        w: box.width,
        paint: `${bg} ${color}`,
        type: s.className,
      }
    })
    return { value, tokens, inputFont: font, layerFont: `${getComputedStyle(layer).fontSize} ${getComputedStyle(layer).fontFamily}` }
  })
}

export default async function run(h) {
  // Quick Entry
  const qe = await h.showQuick('entry')
  await h.wait(800)
  await qe.keyboard.type(TYPED, { delay: 25 })
  await h.wait(700)
  const m = await measureHighlights(qe)
  await h.capture('quick-entry', { page: qe, transparent: true })

  await h.assert('Quick Entry highlights the date, label and priority', { ok: m.tokens.length >= 3, detail: `${m.tokens.length} tokens` })
  const worstX = Math.max(0, ...m.tokens.map((t) => Math.abs(t.x - t.expectedX)))
  const worstW = Math.max(0, ...m.tokens.map((t) => Math.abs(t.w - t.expectedW)))
  await h.assert('Quick Entry highlights sit under the typed text (within 1 px)', {
    ok: m.tokens.length > 0 && worstX <= 1 && worstW <= 1.5,
    detail: `worst offset ${worstX.toFixed(1)} px, worst width difference ${worstW.toFixed(1)} px; input font "${m.inputFont}", highlight font "${m.layerFont}"`,
  })
  if (h.options['forced-colors']) {
    h.emit({ t: 'skip', id: 'E13', message: 'token colours are not compared under forced colors (the system colours replace them; see E12)' })
  } else {
    const paints = new Set(m.tokens.map((t) => t.paint))
    await h.assert('Quick Entry token types have different colours', { ok: paints.size === m.tokens.length && m.tokens.length > 1, detail: m.tokens.map((t) => `${t.type}: ${t.paint}`).join(' | ') })
  }

  await qe.keyboard.press('Escape')
  await h.hideQuick('entry')

  // Quick View
  const qv = await h.showQuick('view')
  const shown = await qv
    .getByText('Call the plumber about the kitchen leak')
    .first()
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  await h.wait(1200)
  await h.capture('quick-view', { page: qv, transparent: true })
  await h.assert('Quick View lists the open tasks', shown)
  if (h.wave !== null && h.wave >= 2) {
    h.emit({ t: 'skip', id: 'E13', wave: 2, message: 'circle checkboxes and priority marks in Quick View: not implemented yet' })
  }
  await qv.keyboard.press('Escape')
  await h.hideQuick('view')
}
