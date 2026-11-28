// PROT (cross-app semantics 21.21 and 21.16): 1:1 topics and a group's blockers, commitments and
// stops in the running app.
//
//   A. A label marked private through its menu. A person's page lists the tasks with the person's
//      label and no promise as Topics: undated ones now, one dated far ahead under Later, a promise's
//      task not at all, and a "Private" mark on the one with the private label.
//   B. "Add a topic" makes a task with the person's label and no promise. Copy agenda names the
//      topics and leaves the private one out.
//   C. A group's page: a blocker, a commitment and a stop are added and written to the ledger with
//      the group; "Out of the way" closes the blocker and Undo opens it again; the copied agenda
//      names the open blocker.
//
// Throwaway people and labels ("... Protx"), tasks titled PROTX; all removed at the end, Pro off again.

import { kit, isoDay } from './_pro-groups.mjs'

export const meta = {
  id: 'PROT',
  wave: 9,
  title: 'Pro: 1:1 topics, a private label, blockers, commitments and stops',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const k = kit(h, 'PROTX')
  const match = (title) => title.includes('Protx')
  await k.cleanup({ match })

  try {
    const jan = await k.makePerson('Jan Protx')
    const secret = await k.makeLabel('Secret Protx')
    const team = await k.makeLabel('Team Protx')
    await k.makeGroup({ name: 'Team Protx', label: team, people: [jan] })
    const vendor = await k.makeTask('PROTX vendor work', { labels: [jan] })
    const paper = await k.makeTask('PROTX board paper', { labels: [jan, secret] })
    const far = await k.makeTask('PROTX far away', { labels: [jan], due: 20 })
    const promised = await k.makeTask('PROTX site list', { labels: [jan], due: 3 })
    await k.setPromise(promised.id, { dir: 'theirs', person: jan.id })
    await k.start()

    // --- A. The private label and the Topics section ---------------------------------------------------
    await h.goto('/inbox')
    await h.wait(800)
    await page.getByRole('button', { name: 'Secret Protx', exact: true }).first().click({ button: 'right' })
    const item = page.getByRole('menuitemradio', { name: 'Private label' })
    await item.waitFor({ timeout: 5000 })
    await k.check('A: the label menu offers "Private label", not ticked yet', (await item.getAttribute('aria-checked')) === 'false')
    await h.capture('label-menu')
    await item.click()
    const marked = await k.waitFor(async () => (await k.prefs())[`label_kind.${secret.id}`] === 'private')
    await k.check('A: the label is marked "private" in the synced settings', !!marked)

    await h.goto(`/person/${jan.id}`)
    await h.wait(1200)
    const inTopics = (id) => page.locator(`[data-pro-topics] [data-pro-topic="${id}"]`).count()
    const inLater = (id) => page.locator(`[data-pro-topics-later] [data-pro-topic="${id}"]`).count()
    await k.check('A: both undated topics are listed', (await inTopics(vendor.id)) === 1 && (await inTopics(paper.id)) === 1)
    await k.check('A: neither is under Later', (await inLater(vendor.id)) === 0 && (await inLater(paper.id)) === 0)
    await k.check('A: the topic dated far ahead waits under Later', (await inLater(far.id)) === 1)
    await k.check("A: a promise's task is no topic", (await inTopics(promised.id)) === 0)
    await k.check('A: the private topic says so in words', ((await page.locator(`[data-pro-topic="${paper.id}"] [data-pro-topic-private]`).textContent()) ?? '').trim() === 'Private')
    await k.check('A: the other topic has no such mark', (await page.locator(`[data-pro-topic="${vendor.id}"] [data-pro-topic-private]`).count()) === 0)
    await h.capture('person-topics')

    // --- B. Add a topic, copy the agenda -----------------------------------------------------------------
    await page.locator('[data-pro-add-topic]').click()
    await h.wait(300)
    await page.keyboard.type('PROTX hiring plan', { delay: 12 })
    await h.wait(300)
    await page.keyboard.press('Enter')
    await h.wait(400)
    await page.keyboard.press('Escape')
    const added = await k.waitTask('PROTX hiring plan')
    await k.check('B: the new topic is a task on the server', !!added)
    if (added) {
      k.state.tasks.push(added.id)
      const labelled = await k.waitFor(async () => ((await h.api('GET', `/tasks/${added.id}`)).labels ?? []).some((l) => l.id === jan.id))
      await k.check("B: it carries the person's label", !!labelled)
      await k.check('B: it has no promise', !(await k.ledger()).promises[String(added.id)]?.value)
      await k.check('B: it shows under Topics', !!(await k.waitFor(async () => (await inTopics(added.id)) === 1)))
    }
    await k.clearClipboard()
    await page.getByRole('button', { name: 'Copy agenda' }).click()
    const agenda = (await k.waitFor(async () => (await k.clipboard()) || null)) ?? ''
    await k.check('B: the copied agenda has a Topics part', agenda.split('\n').includes('Topics'), agenda.slice(0, 600))
    await k.check('B: it names the open topic', agenda.includes('PROTX vendor work'), agenda.slice(0, 600))
    await k.check('B: it leaves the private topic out', !agenda.includes('PROTX board paper'), agenda.slice(0, 600))
    await k.check('B: it leaves the topic for later out', !agenda.includes('PROTX far away'), agenda.slice(0, 600))

    // --- C. Blockers, commitments and stops ----------------------------------------------------------------
    await h.goto(`/group/${team.id}`)
    await h.wait(1200)
    for (const [kind, text] of [['blocker', 'No test environment Protx'], ['commitment', 'Pilot live by March Protx'], ['stop', 'The status deck Protx']]) {
      const input = page.locator(`[data-pro-log="${kind}"] input`)
      await input.fill(text)
      await input.press('Enter')
      await h.wait(300)
    }
    const entries = async () => Object.entries((await k.ledger()).log).map(([id, r]) => ({ id, ...r.value })).filter((v) => v.group === team.id)
    const log = (await k.waitFor(async () => ((await entries()).length >= 3 ? entries() : null))) ?? []
    const kinds = log.map((v) => `${v.kind}:${v.text}`).sort()
    await k.check('C: the ledger holds a blocker, a commitment and a stop of the group', JSON.stringify(kinds) === JSON.stringify(['blocker:No test environment Protx', 'commitment:Pilot live by March Protx', 'stop:The status deck Protx']), JSON.stringify(kinds))
    await k.check('C: each list shows its entry', (await page.locator('[data-pro-log="blocker"] [data-pro-log-entry]').count()) === 1 && (await page.locator('[data-pro-log="commitment"] [data-pro-log-entry]').count()) === 1 && (await page.locator('[data-pro-log="stop"] [data-pro-log-entry]').count()) === 1)
    await h.capture('group-log-six')

    await k.clearClipboard()
    await page.locator('[data-pro-copy-agenda="weekly"]').click()
    const text = (await k.waitFor(async () => (await k.clipboard()) || null)) ?? ''
    await k.check('C: the copied agenda has "Open blockers" with the blocker', text.includes('Open blockers') && text.includes('No test environment Protx'), text.slice(0, 600))
    await k.check('C: the agenda leaves commitments and stops out', !text.includes('Pilot live by March') && !text.includes('The status deck'), text.slice(0, 600))

    const blocker = log.find((v) => v.kind === 'blocker')
    if (blocker) {
      await page.locator(`[data-pro-close="${blocker.id}"]`).click()
      const closed = await k.waitFor(async () => (await entries()).find((v) => v.id === blocker.id)?.resolved === isoDay(0))
      await k.check('C: "Out of the way" writes today as resolved', !!closed, JSON.stringify((await entries()).find((v) => v.id === blocker.id)))
      await k.check('C: the closed blocker leaves the list', !!(await k.waitFor(async () => (await page.locator('[data-pro-log="blocker"] [data-pro-log-entry]').count()) === 0)))
      await page.getByRole('button', { name: 'Undo' }).last().click()
      const reopened = await k.waitFor(async () => !(await entries()).find((v) => v.id === blocker.id)?.resolved)
      await k.check('C: Undo opens it again', !!reopened, JSON.stringify((await entries()).find((v) => v.id === blocker.id)))
    }
    await h.axe()
  } finally {
    await k.cleanup({ match })
  }
}
