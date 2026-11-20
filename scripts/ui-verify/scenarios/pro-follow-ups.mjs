// PROF (cross-app semantics 21.18): the follow-ups block at the top of Today.
//
//   A. The lines come in the rule's order: verdict, check, bring, recap, note.
//   B. A check line (a person's action due soon, in a group with checks on): Copy message greets the
//      person by first name and names the action, marks the promise as checked and the line goes;
//      Undo brings it back.
//   C. Dismiss for today hides a line and the device config keeps `pro_followup_dismissed`.
//   D. A promise with `check_on` today shows a bring line; Checked removes it.
//   E. The weekly note line (ledger setting note_day) opens the weekly note dialog.
//   F. An ended session whose recap was not copied shows a recap line that opens the recap dialog.
//   G. Settings, Pro: the Follow-ups card renders and "check days" writes the ledger setting.
//
// Throwaway people and labels ("... Progf"), tasks titled PROGF; removed at the end, Pro off again.

import { kit, isoDay } from './_pro-groups.mjs'

export const meta = {
  id: 'PROF',
  wave: 9,
  title: 'Pro: follow-ups on Today (verdict, check, bring, recap, note) and their settings',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const k = kit(h, 'PROGF')
  const match = (title) => title.includes('Progf')
  await k.cleanup({ match })

  try {
    const jan = await k.makePerson('Jan Progf')
    const maya = await k.makePerson('Maya Progf')
    const label = await k.makeLabel('Crew Progf')
    const group = await k.makeGroup({ name: 'Crew Progf', label, people: [jan, maya], checks: true })
    const overdue = await k.makeTask('PROGF overdue report', { labels: [label], due: -1 })
    const check = await k.makeTask('PROGF site list', { labels: [label], due: 1 })
    const bring = await k.makeTask('PROGF look at budget', { labels: [label], due: 10 })
    await k.setPromise(overdue.id, { dir: 'theirs', person: maya.id, to: { group: label.id } })
    await k.setPromise(check.id, { dir: 'theirs', person: jan.id, to: { group: label.id } })
    await k.setPromise(bring.id, { dir: 'theirs', person: maya.id, to: { group: label.id }, check_on: isoDay(0) })
    const roundId = `rprogf${Math.random().toString(36).slice(2, 8)}`
    await k.mutate([
      {
        op: 'set',
        collection: 'rounds',
        id: roundId,
        value: { meeting: group.id, at: isoDay(0), discussed: [], skipped: [], absent: [], not_discussed: [], kind: 'weekly', started: new Date(Date.now() - 3600e3).toISOString(), ended: new Date(Date.now() - 60e3).toISOString() },
      },
    ])
    const weekday = new Date().getDay() || 7
    await k.mutate([{ op: 'settings', value: { ...(k.state.settings ?? {}), note_day: weekday } }])
    await k.start()

    // --- A. The block -------------------------------------------------------------------------------------
    await h.goto('/today')
    await h.wait(1500)
    await page.locator('[data-pro-follow-ups]').waitFor({ timeout: 8000 }).catch(() => {})
    const keys = async () => page.locator('[data-pro-follow-up]').evaluateAll((els) => els.map((e) => e.getAttribute('data-pro-follow-up')))
    const order = await k.waitFor(async () => {
      const found = await keys()
      return found.length >= 5 ? found : null
    })
    const expected = [`verdict:${overdue.id}`, `check:${jan.id}`, `bring:${bring.id}`, `recap:${roundId}`, `note:${isoDay(0)}`]
    await k.check('A: the lines come in the order verdict, check, bring, recap, note', JSON.stringify(order) === JSON.stringify(expected), JSON.stringify({ order, expected }))
    await k.check('A: the verdict row is a task row under the block', (await page.locator(`[data-pro-follow-ups] [data-pro-promises-due] [data-task-id="${overdue.id}"]`).count()) === 1)
    await k.check('A: the old "Promises due" header is gone', (await page.getByText('Promises due', { exact: true }).count()) === 0)
    await h.capture('today-follow-ups')
    await k.check('A: the check line names the person and the action', /Jan:/.test(await page.locator(`[data-pro-follow-up="check:${jan.id}"]`).innerText()) && (await page.locator(`[data-pro-follow-up="check:${jan.id}"]`).innerText()).includes('PROGF site list'))
    await h.axe('[data-pro-follow-ups]')

    // --- B. Copy message, marks, Undo -----------------------------------------------------------------------
    await k.clearClipboard()
    await page.locator(`[data-pro-follow-up="check:${jan.id}"] [data-pro-follow-up-copy]`).click()
    const text = (await k.waitFor(async () => (await k.clipboard()) || null)) ?? ''
    await k.check('B: the message greets the first name', /Jan\b/.test(text) && !text.includes('Progf Jan'), text)
    await k.check('B: the message names the action', text.includes('PROGF site list'), text)
    const checked = await k.waitFor(async () => ((await k.ledger()).promises[String(check.id)]?.value?.checked ?? []).length === 1)
    await k.check('B: the promise got a checked mark', !!checked)
    await h.wait(600)
    await k.check('B: the line is gone', (await page.locator(`[data-pro-follow-up="check:${jan.id}"]`).count()) === 0)
    await h.capture('after-copy-message')
    await page.getByText(/Message copied/).locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]').getByRole('button', { name: 'Undo' }).click()
    const unchecked = await k.waitFor(async () => ((await k.ledger()).promises[String(check.id)]?.value?.checked ?? []).length === 0)
    await k.check('B: Undo takes the checked mark away', !!unchecked)
    await h.wait(2500)
    const stillGone = ((await k.ledger()).promises[String(check.id)]?.value?.checked ?? []).length === 0
    await k.check('B: the checked mark stays removed after the next sync (union merge)', stillGone)
    await k.check('B: Undo brings the line back', (await page.locator(`[data-pro-follow-up="check:${jan.id}"]`).count()) === 1)
    if (!stillGone) {
      // The mark came back with the sync: remake the promise (a tombstone, then a new record) to go on.
      await k.setPromise(check.id, null)
      await h.wait(1500)
      await k.setPromise(check.id, { dir: 'theirs', person: jan.id, to: { group: label.id } })
      await h.wait(1500)
    }

    // --- C. Dismiss -----------------------------------------------------------------------------------------------
    await page.locator(`[data-pro-follow-up="check:${jan.id}"] [data-pro-follow-up-dismiss]`).click()
    await h.wait(700)
    await k.check('C: Dismiss removes the line', (await page.locator(`[data-pro-follow-up="check:${jan.id}"]`).count()) === 0)
    const dismissed = (await page.evaluate(() => window.api.getConfig())).pro_followup_dismissed ?? {}
    await k.check('C: the device config holds pro_followup_dismissed for the line, until tomorrow', dismissed[`check:${jan.id}`] === isoDay(1), JSON.stringify(dismissed))

    // --- D. Bring -------------------------------------------------------------------------------------------------
    await page.locator(`[data-pro-follow-up="bring:${bring.id}"] [data-pro-follow-up-checked]`).click()
    const broughtMark = await k.waitFor(async () => ((await k.ledger()).promises[String(bring.id)]?.value?.checked ?? []).length === 1)
    await k.check('D: Checked writes a checked mark', !!broughtMark)
    await h.wait(600)
    await k.check('D: the bring line is gone', (await page.locator(`[data-pro-follow-up="bring:${bring.id}"]`).count()) === 0)

    // --- E. Weekly note ---------------------------------------------------------------------------------------------
    await page.locator('[data-pro-follow-up^="note:"] [data-pro-follow-up-note]').click()
    await page.locator('[data-pro-weekly-note]').waitFor({ timeout: 8000 }).catch(() => {})
    await k.check('E: Write it opens the weekly note', (await page.locator('[data-pro-weekly-note]').count()) === 1)
    await page.keyboard.press('Escape')
    await h.wait(400)

    // --- F. Recap ---------------------------------------------------------------------------------------------------
    await page.locator(`[data-pro-follow-up="recap:${roundId}"] [data-pro-follow-up-recap]`).click()
    await page.locator('[data-pro-session-recap]').waitFor({ timeout: 8000 }).catch(() => {})
    await k.check('F: Open recap opens the recap dialog', (await page.locator('[data-pro-session-recap]').count()) === 1)
    await h.capture('recap-from-follow-up')
    await page.keyboard.press('Escape')
    await h.wait(400)

    // --- G. Settings ---------------------------------------------------------------------------------------------------
    await h.goto('/settings?section=pro')
    await h.wait(1200)
    const card = page.locator('[data-pro-follow-up-settings]')
    await card.waitFor({ timeout: 8000 }).catch(() => {})
    await k.check('G: the Follow-ups card renders', (await card.count()) === 1)
    await card.scrollIntoViewIfNeeded().catch(() => {})
    await h.capture('settings-follow-ups')
    await card.locator('input[type="number"]').fill('3')
    const days = await k.waitFor(async () => (await k.ledger()).settings?.value?.check_days === 3)
    await k.check('G: changing check days writes the ledger setting check_days', !!days, JSON.stringify((await k.ledger()).settings?.value))
    await h.axe('[data-pro-follow-up-settings]')
  } finally {
    await k.cleanup({ match })
  }
}
