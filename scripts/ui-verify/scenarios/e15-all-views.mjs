// E15 (plan section 5): every view at 1440x900, 1280x820 and 900x600, in the theme of the run (--theme),
// read-only (navigation and Settings tabs only, nothing is written to the server).
//
// Per view and size, one capture and these assertions:
//   - nothing overflows horizontally: the document, <body> and <main> have no horizontal scroll, and no
//     element of the main region is wider than the region unless an ancestor inside it clips or scrolls it;
//   - no clipped text: no text is cut off by an overflow:hidden ancestor that does not ellipsize it;
//   - the page heading (h1) is visible inside the window and not empty.
// Views: Inbox, Today, Upcoming, Anytime, Logbook, a project, a tag, the first custom list (skipped when the
// seed has none), Search, Review, Routines and each Settings section.
export const meta = {
  id: 'E15',
  wave: 6,
  title: 'All views at 1440x900, 1280x820, 900x600, light and dark: no overflow, no clipped text, the heading visible',
}

const SIZES = [
  [1440, 900],
  [1280, 820],
  [900, 600],
]

const SETTINGS_SECTIONS = ['General', 'Projects', 'Quick Entry / View', 'Notifications', 'Keyboard Shortcuts']

/** Runs in the page: layout facts about the content region and the heading. */
export function auditLayout() {
  const root = document.documentElement
  const main = document.querySelector('main')
  const out = {
    doc: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth },
    body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
    main: main ? { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth } : null,
    wide: [],
    clipped: [],
    heading: null,
  }
  const label = (el) => {
    const id = el.getAttribute('data-task-id')
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    return `${el.tagName.toLowerCase()}${id ? `[task ${id}]` : ''}${cls ? '.' + cls : ''} "${(el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`
  }

  if (main) {
    const region = main.getBoundingClientRect()
    // The ancestors of `el` inside the region that clip or scroll horizontally.
    const clippers = (el) => {
      const found = []
      for (let n = el.parentElement; n && n !== main; n = n.parentElement) {
        const cs = getComputedStyle(n)
        if (cs.overflowX !== 'visible') found.push({ node: n, cs })
      }
      return found
    }
    const visible = (el, rect, cs) => rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    for (const el of main.querySelectorAll('*')) {
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') continue
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (!visible(el, rect, cs) || cs.position === 'fixed') continue
      // Wider than the region (or pushed out of its left edge) with nothing inside the region to contain it.
      // A vertical scroller computes overflow-x as auto too, so only hidden and clip count as containing it.
      if ((rect.right > region.right + 1 || rect.left < region.left - 1) && !clippers(el).some((c) => c.cs.overflowX === 'hidden' || c.cs.overflowX === 'clip')) {
        if (out.wide.length < 6) out.wide.push(`${label(el)} ${Math.round(rect.left)}..${Math.round(rect.right)} vs region ${Math.round(region.left)}..${Math.round(region.right)}`)
      }
      // Text cut off at the side by an ancestor that hides overflow without an ellipsis.
      if (rect.width > 2 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        for (const { node, cs: ncs } of clippers(el)) {
          if (ncs.overflowX === 'auto' || ncs.overflowX === 'scroll') continue // scrolls: reachable
          if (ncs.textOverflow === 'ellipsis') continue // truncated on purpose, with a mark
          const box = node.getBoundingClientRect()
          if (box.width <= 2) continue // sr-only and the like
          if (rect.right > box.right + 1 || rect.left < box.left - 1) {
            if (out.clipped.length < 6) out.clipped.push(`${label(el)} ${Math.round(rect.left)}..${Math.round(rect.right)} cut by ${label(node)} ${Math.round(box.left)}..${Math.round(box.right)}`)
            break
          }
        }
      }
    }
  }

  const h1 = document.querySelector('main h1') ?? document.querySelector('h1')
  if (h1) {
    const r = h1.getBoundingClientRect()
    const cs = getComputedStyle(h1)
    out.heading = {
      text: (h1.textContent ?? '').trim(),
      inWindow: r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
      shown: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01,
    }
  }
  return out
}

export default async function run(h) {
  const page = h.page
  const theme = h.options.theme

  // [name, open(), heading pattern]
  const views = [
    ['inbox', () => h.goto('/inbox'), /inbox/i],
    ['today', () => h.goto('/today'), /today/i],
    ['upcoming', () => h.goto('/upcoming'), /upcoming/i],
    ['anytime', () => h.goto('/anytime'), /anytime/i],
    ['logbook', () => h.goto('/logbook'), /logbook/i],
    ['project', () => h.goto(`/project/${h.ids.website}`), /\S/],
    ['tag', () => h.goto(`/tag/${h.ids.labels['deep work']}`), /\S/],
    [
      'custom-list',
      async () => {
        await h.goto('/today')
        const clicked = await page.evaluate(() => {
          const item = document.querySelector('nav[aria-label="Custom lists"] button')
          if (!item) return false
          item.click()
          return true
        })
        await h.wait(700)
        return clicked
      },
      /\S/,
    ],
    ['search', () => h.goto('/search?q=passport'), /search/i],
    ['review', () => h.goto('/review'), /review/i],
    ['routines', () => h.goto('/routines'), /routines/i],
    ...SETTINGS_SECTIONS.map((section) => [
      `settings-${section.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`,
      async () => {
        await h.goto('/settings')
        await page.getByRole('button', { name: section, exact: true }).click()
        await h.wait(500)
      },
      /settings/i,
    ]),
  ]

  let customListSkipped = false
  for (const [width, height] of SIZES) {
    await h.resize(width, height)
    const size = `${width}x${height}`
    for (const [name, open, heading] of views) {
      await h.dismiss()
      const opened = await open()
      if (name === 'custom-list' && opened === false) {
        if (!customListSkipped) h.emit({ t: 'skip', id: meta.id, message: 'the seed has no custom list' })
        customListSkipped = true
        continue
      }
      await h.wait(600)
      await h.capture(`${name}-${size}`)
      const audit = await page.evaluate(auditLayout)
      const tag = `${name} at ${size} (${theme})`

      await h.assert(`${tag}: the page does not scroll horizontally (document, body and main)`, {
        ok:
          audit.doc.scrollWidth <= audit.doc.clientWidth &&
          audit.body.scrollWidth <= audit.body.clientWidth &&
          !!audit.main &&
          audit.main.scrollWidth <= audit.main.clientWidth,
        detail: JSON.stringify({ doc: audit.doc, body: audit.body, main: audit.main }),
      })
      await h.assert(`${tag}: no element of the main region is wider than the region`, { ok: audit.wide.length === 0, detail: audit.wide.join(' | ') })
      await h.assert(`${tag}: no text is clipped without an ellipsis`, { ok: audit.clipped.length === 0, detail: audit.clipped.join(' | ') })
      await h.assert(`${tag}: the page heading is visible and not empty`, {
        ok: !!audit.heading && audit.heading.shown && audit.heading.inWindow && heading.test(audit.heading.text),
        detail: JSON.stringify(audit.heading),
      })
    }
  }
  await h.dismiss()
}
