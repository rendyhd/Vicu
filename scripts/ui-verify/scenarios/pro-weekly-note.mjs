// PRON (cross-app semantics 21.19): the weekly note.
//
//   A. The command palette's "Weekly note" opens the dialog; the preview has a block per group, with
//      what was delivered, decided and left open, and "Nothing to report." for an empty group.
//   B. Copy as Markdown puts Markdown on the clipboard and writes `note_sent` in the ledger settings
//      (and the toast's Undo removes it again).
//
// Throwaway people and labels ("... Progn"), tasks titled PROGN; removed at the end, Pro off again.

import { kit } from './_pro-groups.mjs'

export const meta = {
  id: 'PRON',
  wave: 9,
  title: 'Pro: the weekly note from the palette, a block per group, copy and its mark',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const k = kit(h, 'PROGN')
  const match = (title) => title.includes('Progn')
  await k.cleanup({ match })

  try {
    const jan = await k.makePerson('Jan Progn')
    const alphaLabel = await k.makeLabel('Alpha Progn')
    const betaLabel = await k.makeLabel('Beta Progn')
    await k.makeGroup({ name: 'Alpha Progn', label: alphaLabel, people: [jan] })
    await k.makeGroup({ name: 'Beta Progn', label: betaLabel, people: [] })
    const delivered = await k.makeTask('PROGN ship the build', { labels: [alphaLabel], due: 0, done: true })
    await k.setPromise(delivered.id, {
      dir: 'theirs',
      person: jan.id,
      to: { group: alphaLabel.id },
      verdicts: [{ id: 'vprogn1', at: new Date().toISOString(), kind: 'delivered' }],
    })
    const day = new Date()
    const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    await k.mutate([
      { op: 'set', collection: 'log', id: 'lprogn1', value: { kind: 'decision', text: 'Freeze scope Progn', at: today, group: alphaLabel.id } },
      { op: 'set', collection: 'log', id: 'lprogn2', value: { kind: 'issue', text: 'Flaky tests Progn', at: today, group: alphaLabel.id, rank: 1 } },
    ])
    await k.start()

    // --- A. The dialog ------------------------------------------------------------------------------------
    await h.goto('/inbox')
    await h.wait(900)
    await page.keyboard.press('Control+Shift+P')
    await page.locator('dialog[aria-label="Command palette"] input').waitFor({ timeout: 5000 })
    await page.keyboard.type('weekly note', { delay: 15 })
    await h.wait(500)
    await page.keyboard.press('Enter')
    await page.locator('[data-pro-weekly-note]').waitFor({ timeout: 8000 }).catch(() => {})
    await h.wait(1500)
    const preview = (await page.locator('[data-pro-weekly-note]').textContent().catch(() => '')) ?? ''
    await k.check('A: the palette opens the weekly note', preview.length > 0, preview)
    await k.check('A: the preview has a block for Alpha', preview.includes('Alpha Progn'), preview)
    await k.check('A: the preview has a block for Beta', preview.includes('Beta Progn'), preview)
    await k.check('A: Alpha reports the delivered action and the decision', /deliver/i.test(preview) && preview.includes('Freeze scope Progn'), preview)
    await k.check('A: the empty group reads "Nothing to report."', preview.includes('Nothing to report.'), preview)
    await k.check('A: Beta is the one with nothing to report', /Beta Progn[\s\S]*Nothing to report\./.test(preview) && !/Alpha Progn[\s\S]*?Nothing to report\.[\s\S]*Beta Progn/.test(preview), preview)
    await h.capture('weekly-note')
    await h.axe('dialog[open]')

    // --- B. Copy as Markdown -----------------------------------------------------------------------------------
    await k.clearClipboard()
    await page.locator('[data-pro-note-copy-markdown]').click()
    const text = (await k.waitFor(async () => (await k.clipboard()) || null)) ?? ''
    await k.check('B: the clipboard holds Markdown with the group names', /^#|\*\*|^- |^\* /m.test(text) && text.includes('Alpha Progn') && text.includes('Beta Progn'), text.slice(0, 500))
    const sent = await k.waitFor(async () => ((await k.ledger()).settings?.value?.note_sent ?? []).length === 1)
    await k.check('B: note_sent is written in the ledger settings', !!sent, JSON.stringify((await k.ledger()).settings?.value))
    await h.wait(500)
    await page.getByText(/Weekly note copied/).locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]').getByRole('button', { name: 'Undo' }).click()
    const gone = await k.waitFor(async () => ((await k.ledger()).settings?.value?.note_sent ?? []).length === 0)
    await k.check('B: Undo removes note_sent', !!gone, JSON.stringify((await k.ledger()).settings?.value))
  } finally {
    await k.cleanup({ match })
  }
}
