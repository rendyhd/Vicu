// PROS (cross-app semantics 21.16 and 21.17): a weekly session of a group in the running app.
//
//   A. Start a weekly session from the group page; the steps are there; Maya is marked absent.
//   B. Actions: "Not yet" on an overdue action; a second "Not yet" on an action with one miss adds an
//      issue naming it (21.16), written in the session.
//   C. Issues: add one, solve the miss issue.
//   D. New actions: a task made in the session composer, and a decision.
//   E. Read-back names the decision and the new action; tick it, pick a score, End session.
//   F. The recap dialog names the decision; Copy writes recap_sent on the round, `sent` on the
//      promises in it and `shared` on the decision; Undo takes those marks away. The round holds
//      kind, started, ended, read_back, score and the absent person.
//
// Throwaway people and labels ("... Progs"), tasks titled PROGS; removed at the end, Pro off again.

import { kit, isoDay } from './_pro-groups.mjs'

export const meta = {
  id: 'PROS',
  wave: 9,
  title: 'Pro: a weekly session, verdicts, issues, new actions, read-back, recap and its marks',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const k = kit(h, 'PROGS')
  const match = (title) => title.includes('Progs')
  await k.cleanup({ match })

  try {
    const jan = await k.makePerson('Jan Progs')
    const maya = await k.makePerson('Maya Progs')
    const label = await k.makeLabel('Crew Progs')
    const group = await k.makeGroup({ name: 'Crew Progs', label, people: [jan, maya] })
    const t1 = await k.makeTask('PROGS late deck', { labels: [label], due: -2 })
    const t3 = await k.makeTask('PROGS twice missed', { labels: [label], due: -1 })
    const t2 = await k.makeTask('PROGS next report', { labels: [label], due: 3 })
    await k.setPromise(t1.id, { dir: 'theirs', person: jan.id, to: { group: label.id } })
    await k.setPromise(t3.id, {
      dir: 'theirs',
      person: maya.id,
      to: { group: label.id },
      verdicts: [{ id: 'vseed1', at: new Date(Date.now() - 3 * 86400e3).toISOString(), kind: 'not_yet', new_due: isoDay(-1) }],
    })
    await k.setPromise(t2.id, { dir: 'theirs', person: maya.id, to: { group: label.id } })
    await k.start()

    // --- A. Start ---------------------------------------------------------------------------------------
    await h.goto(`/group/${label.id}`)
    await h.wait(1300)
    await page.locator('[data-pro-start-session="weekly"]').click()
    await page.locator('[data-pro-session-start]').waitFor({ timeout: 5000 })
    await k.check('A: the session page opened', page.url().includes(`/session/${group.id}/weekly`), page.url())
    await h.capture('session-before')
    await page.locator('[data-pro-session-start]').click()
    await page.locator('[data-pro-session-end]').waitFor({ timeout: 5000 })
    const round = (await page.locator('[data-pro-session]').getAttribute('data-pro-session')) ?? ''
    await k.check('A: a round id was chosen', round.length > 4, round)
    const steps = await page.locator('[data-pro-session-step]').evaluateAll((els) => els.map((e) => e.getAttribute('data-pro-session-step')))
    await k.check('A: weekly has the four steps in order', JSON.stringify(steps) === JSON.stringify(['actions', 'issues', 'new', 'readback']), JSON.stringify(steps))
    await k.check('A: the late and the twice-missed action need a verdict', (await page.locator(`[data-pro-session-actions] [data-task-id="${t1.id}"]`).count()) === 1 && (await page.locator(`[data-pro-session-actions] [data-task-id="${t3.id}"]`).count()) === 1)
    await page.locator('[data-pro-session-absent] button', { hasText: 'Maya Progs' }).click()
    await h.capture('session-actions')

    // --- B. Verdicts --------------------------------------------------------------------------------------
    const notYet = async (taskId, blocker) => {
      await page.locator(`[data-pro-session-actions] [data-task-id="${taskId}"] [data-pro-person-mark]`).click()
      await page.locator('[data-pro-verdict="not_yet"]').click()
      await page.locator('[data-pro-verdict-form] input[placeholder="What is in the way?"]').fill(blocker)
      await h.capture(`verdict-form-${taskId === t1.id ? 'first' : 'second'}`)
      await page.locator('[data-pro-verdict-form]').getByRole('button', { name: 'Save' }).click()
    }
    await notYet(t1.id, 'waiting on the vendor')
    const v1 = await k.waitFor(async () => ((await k.ledger()).promises[String(t1.id)]?.value?.verdicts ?? []).filter((v) => v.kind === 'not_yet').length === 1)
    await k.check('B: the first Not yet is in the ledger', !!v1)
    await h.wait(700)
    const issuesOf = async () => Object.entries((await k.ledger()).log).filter(([, r]) => r.value?.kind === 'issue' && r.value?.group === label.id)
    await k.check('B: one miss adds no issue', (await issuesOf()).length === 0)
    await notYet(t3.id, 'still no answer')
    const issue = await k.waitFor(async () => (await issuesOf()).find(([, r]) => r.value?.task === t3.id) ?? null)
    await k.check('B: the second Not yet adds an issue naming the task', !!issue && issue[1].value.text === 'PROGS twice missed', JSON.stringify(issue))
    await k.check('B: the issue was written in the session', issue?.[1].value.session === round, JSON.stringify(issue?.[1].value))
    await k.check('B: the first action has no issue', !(await issuesOf()).some(([, r]) => r.value?.task === t1.id))

    // --- C. Issues -----------------------------------------------------------------------------------------
    await page.locator('[data-pro-session-next]').click()
    await page.locator('[data-pro-log="issue"]').waitFor({ timeout: 5000 })
    await k.check('C: the miss issue is listed', (await page.locator(`[data-pro-issue="${issue?.[0]}"]`).count()) === 1)
    await page.locator('[data-pro-log="issue"] input').fill('Vendor is slow Progs')
    await page.locator('[data-pro-log="issue"] input').press('Enter')
    const added = await k.waitFor(async () => (await issuesOf()).find(([, r]) => r.value?.text === 'Vendor is slow Progs') ?? null)
    await k.check('C: the added issue is in the log, captured in the session', added?.[1].value.session === round, JSON.stringify(added))
    await h.capture('session-issues')
    await page.locator(`[data-pro-issue="${issue?.[0]}"] button`).last().click()
    const solved = await k.waitFor(async () => {
      const v = (await k.ledger()).log[issue?.[0]]?.value
      return v?.resolved ? v : null
    })
    await k.check('C: solving the miss issue writes resolved and solved_in', !!solved && solved.solved_in === round, JSON.stringify(solved))

    // --- D. New actions and a decision -----------------------------------------------------------------------
    await page.locator('[data-pro-session-next]').click()
    await page.locator('[data-pro-session-new]').waitFor({ timeout: 5000 })
    const composer = page.locator('[data-pro-session-new] input[placeholder="New task"]').first()
    await composer.click()
    await page.keyboard.type('$"Maya Progs" PROGS book the venue tomorrow', { delay: 12 })
    await h.wait(350)
    await page.keyboard.press('Enter')
    const made = await k.waitTask('PROGS book the venue')
    await k.check('D: the task was made in the session', !!made)
    if (made) k.state.tasks.push(made.id)
    await page.keyboard.press('Escape')
    // A session holds the tasks created between its two times, read from the server's `created`; the
    // test server's container clock runs a few seconds ahead of this computer, so let that pass.
    await h.wait(4500)
    await page.locator('[data-pro-log="decision"] input').fill('Venue is booked in March Progs')
    await page.locator('[data-pro-log="decision"] input').press('Enter')
    const decision = await k.waitFor(async () => Object.entries((await k.ledger()).log).find(([, r]) => r.value?.kind === 'decision' && r.value?.group === label.id) ?? null)
    await k.check('D: the decision is captured in the session', decision?.[1].value.session === round, JSON.stringify(decision))
    await h.wait(900)
    await k.check('D: the new action is listed as captured', !!made && (await page.locator(`[data-pro-session-new] [data-task-id="${made.id}"]`).count()) >= 1)
    await h.capture('session-new')

    // --- E. Read-back ----------------------------------------------------------------------------------------
    await page.locator('[data-pro-session-next]').click()
    await page.locator('[data-pro-read-back]').waitFor({ timeout: 5000 })
    const readBack = (await k.waitFor(async () => ((await page.locator('[data-pro-read-back]').textContent()) || '').trim() || null)) ?? ''
    await k.check('E: the read-back names the decision', readBack.includes('Venue is booked in March Progs'), readBack)
    await k.check('E: the read-back names the new action', readBack.includes('book the venue'), readBack)
    await page.locator('[data-pro-session-readback] label').first().click()
    await page.locator('[data-pro-session-score]').selectOption('8')
    await h.capture('session-readback')
    await page.locator('[data-pro-session-finish]').click()

    // --- F. Recap -------------------------------------------------------------------------------------------------
    await page.locator('[data-pro-session-recap]').waitFor({ timeout: 8000 })
    const recap = (await page.locator('[data-pro-session-recap]').textContent()) ?? ''
    await k.check('F: the recap names the decision', recap.includes('Venue is booked in March Progs'), recap)
    await k.check('F: the recap names the Not yet change', recap.includes('late deck'), recap)
    await h.capture('session-recap')
    const ended = await k.waitFor(async () => (await k.ledger()).rounds[round]?.value ?? null)
    await k.check('F: the round has kind, started, ended', ended?.kind === 'weekly' && typeof ended?.started === 'string' && typeof ended?.ended === 'string', JSON.stringify(ended))
    await k.check('F: the round has read_back, score 8 and Maya absent', ended?.read_back === true && ended?.score === 8 && JSON.stringify(ended?.absent) === JSON.stringify([maya.id]), JSON.stringify(ended))
    await k.check('F: nothing is marked as sent before Copy', !(ended?.recap_sent ?? []).length)
    await page.locator('[data-pro-recap-copy]').click()
    const marked = await k.waitFor(async () => {
      const led = await k.ledger()
      return (led.rounds[round]?.value?.recap_sent ?? []).length === 1 ? led : null
    })
    await k.check('F: Copy writes one recap_sent mark on the round', !!marked)
    const sent = (id) => (marked?.promises[String(id)]?.value?.sent ?? []).length
    await k.check('F: promises in the recap got a sent mark', sent(t1.id) === 1 && sent(t3.id) === 1 && !!made && sent(made.id) === 1, JSON.stringify([sent(t1.id), sent(t3.id), made && sent(made.id)]))
    await k.check('F: the decision got a shared mark', (marked?.log[decision?.[0]]?.value?.shared ?? []).length === 1, JSON.stringify(marked?.log[decision?.[0]]?.value))
    await k.check('F: a promise outside the recap got no mark', sent(t2.id) === 0)
    await h.wait(600)
    await h.capture('after-copy')
    await page.getByText(/Recap copied/).locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]').getByRole('button', { name: 'Undo' }).click()
    const unmarked = await k.waitFor(async () => {
      const led = await k.ledger()
      return (led.rounds[round]?.value?.recap_sent ?? []).length === 0 ? led : null
    })
    await k.check('F: Undo takes the round mark away', !!unmarked)
    const marksOf = async () => {
      const led = await k.ledger()
      return { sent: [t1.id, t3.id, made?.id].map((id) => led.promises[String(id)]?.value?.sent ?? []), shared: led.log[decision?.[0]]?.value?.shared ?? [], led }
    }
    const now = await marksOf()
    await k.check('F: Undo takes the decision mark away', now.shared.length === 0, JSON.stringify(now.shared))
    await k.check('F: Undo takes the promise sent marks away at once', now.sent.every((m) => m.length === 0), JSON.stringify(now.sent))
    // The ledger merges `sent` marks as a union with the carrier's copy (21.7), so a removed mark can come back with the next sync.
    await h.wait(2500)
    const later = await marksOf()
    await k.check('F: the promise sent marks stay removed after the next sync (union merge)', later.sent.every((m) => m.length === 0), JSON.stringify(later.sent))
    const after = later.led
    await k.check('F: Undo keeps the verdicts', (after.promises[String(t1.id)]?.value?.verdicts ?? []).length === 1)
    await h.goto(`/group/${label.id}`)
    await h.wait(1200)
    await k.check('F: the group page lists the session as not copied', ((await page.locator('[data-pro-group-sessions]').textContent()) ?? '').toLowerCase().includes('not'), (await page.locator('[data-pro-group-sessions]').textContent()) ?? '')
    await h.capture('group-after-session')
    await h.axe()
    // The session page itself, for the accessibility check.
    await page.locator('[data-pro-start-session="weekly"]').click()
    await page.locator('[data-pro-session-start]').click()
    await page.locator('[data-pro-session-end]').waitFor({ timeout: 5000 })
    await h.wait(500)
    await h.axe()
    await page.locator('[data-pro-session-discard]').click()
  } finally {
    await k.cleanup({ match })
  }
}
