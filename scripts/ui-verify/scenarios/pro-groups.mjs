// PROG (cross-app semantics 21.16): groups in the running app.
//
//   A. A group made through the sidebar's "New group" dialog: name, a new label, two people. The page
//      opens, the sidebar row exists, the label exists on the server and is marked "group".
//   B. Actions added on the group's page: one with $person and a date, one for the other person with
//      `for $first`, one without a person. Owners, the no-owner list, "I own this", the ledger's `to`.
//   C. The log: an issue, a decision and a question.
//   D. Edit the group (rename); Copy agenda reads back as text with the group's name and an action.
//
// Throwaway people and labels ("... Progx"), tasks titled PROGX; all removed at the end, Pro off again.

import { kit, list } from './_pro-groups.mjs'

export const meta = {
  id: 'PROG',
  wave: 9,
  title: 'Pro: groups, owners, no-owner list, log, edit, agenda',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()
  const k = kit(h, 'PROGX')
  const match = (title) => title.includes('Progx')
  await k.cleanup({ match })

  try {
    const jan = await k.makePerson('Jan Progx')
    const maya = await k.makePerson('Maya Progx')
    await k.start()

    // --- A. The dialog ------------------------------------------------------------------------------
    await h.goto('/inbox')
    await h.wait(800)
    await page.locator('[data-pro-new-group]').click()
    await page.locator('[data-pro-group-name]').waitFor({ timeout: 5000 })
    await page.locator('[data-pro-group-name]').fill('Team Progx')
    await page.locator('[data-pro-group-add-person]').selectOption(String(jan.id))
    await page.locator('[data-pro-group-add-person]').selectOption(String(maya.id))
    await h.capture('group-dialog')
    await page.locator('[data-pro-group-save]').click()
    const label = await k.waitFor(async () => list(await h.api('GET', '/labels?per_page=200')).find((l) => l.title === 'Team Progx') ?? null)
    await k.check('A: the label Team Progx exists on the server', !!label)
    if (!label) return
    k.state.labels.push(label)
    await k.waitFor(() => page.url().includes(`/group/${label.id}`))
    await k.check('A: the group page opened', page.url().includes(`/group/${label.id}`), page.url())
    await k.check('A: the sidebar has the group row', (await page.locator(`[data-pro-group-nav="${label.id}"]`).count()) === 1)
    const kind = await k.waitFor(async () => (await k.prefs())[`label_kind.${label.id}`] === 'group')
    await k.check('A: the label is marked "group"', !!kind)
    const meeting = await k.waitFor(async () => Object.values((await k.ledger()).meetings).find((r) => r.value?.label === label.id)?.value ?? null)
    await k.check('A: the ledger meeting holds the label, the name and both people in order', meeting?.name === 'Team Progx' && JSON.stringify(meeting?.people) === JSON.stringify([jan.id, maya.id]), JSON.stringify(meeting))
    await k.check('A: the page heading is the name', ((await page.locator('h1').first().textContent()) ?? '').includes('Team Progx'))

    // --- B. Actions -----------------------------------------------------------------------------------
    const add = async (text) => {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+n')
      await h.wait(300)
      await page.keyboard.type(text, { delay: 12 })
      await h.wait(350)
      await page.keyboard.press('Enter')
      await h.wait(400)
    }
    await add('$"Jan Progx" PROGX site list tomorrow')
    await add('$"Maya Progx" PROGX draw plan for $"Jan Progx"')
    await add('PROGX order lunch')
    await page.keyboard.press('Escape')
    const a = await k.waitTask('PROGX site list')
    const b = await k.waitTask('PROGX draw plan')
    const c = await k.waitTask('PROGX order lunch')
    await k.check('B: the three tasks were made without the person words', !!a && !!b && !!c, JSON.stringify([a?.title, b?.title, c?.title]))
    if (!a || !b || !c) return
    for (const t of [a, b, c]) k.state.tasks.push(t.id)
    const labelled = await k.waitFor(async () => {
      for (const t of [a, b, c]) if (!((await h.api('GET', `/tasks/${t.id}`)).labels ?? []).some((l) => l.id === label.id)) return false
      return true
    })
    await k.check('B: each task carries the group label', !!labelled)
    const pa = await k.promiseOf(a.id)
    const pb = await k.promiseOf(b.id)
    await k.check("B: Jan's promise is theirs and made to the group", pa?.dir === 'theirs' && pa?.person === jan.id && pa?.to?.group === label.id, JSON.stringify(pa))
    await k.check("B: Maya's promise is theirs and made to Jan (for $Jan)", pb?.dir === 'theirs' && pb?.person === maya.id && pb?.to?.person === jan.id, JSON.stringify(pb))
    await k.check('B: the third task has no promise', !(await k.ledger()).promises[String(c.id)]?.value)
    await k.refresh()
    await h.goto(`/group/${label.id}`)
    await h.wait(1200)
    const under = (owner, id) => page.locator(`[data-pro-group-part] [data-pro-owner="${owner}"] [data-task-id="${id}"]`).count()
    await k.check("B: Jan's action shows under Jan", (await under(jan.id, a.id)) >= 1)
    await k.check("B: Maya's action shows under Maya", (await under(maya.id, b.id)) >= 1)
    await k.check('B: the no-owner list holds the third', (await page.locator(`[data-pro-no-owner] [data-pro-take="${c.id}"]`).count()) === 1)
    await h.capture('group-page-light')
    await page.locator(`[data-pro-take="${c.id}"]`).click()
    const pc = await k.waitFor(async () => {
      const v = (await k.ledger()).promises[String(c.id)]?.value
      return v ?? null
    })
    await k.check('B: "I own this" writes my promise to the group', pc?.dir === 'mine' && pc?.to?.group === label.id, JSON.stringify(pc))
    await h.wait(600)
    await k.check('B: it moves to Yours', (await page.locator(`[data-pro-group-part="yours"] [data-task-id="${c.id}"]`).count()) >= 1)
    await k.check('B: the no-owner list is gone', (await page.locator('[data-pro-no-owner]').count()) === 0)

    // --- C. The log -----------------------------------------------------------------------------------
    for (const [kindName, text] of [['issue', 'Printer jams Progx'], ['decision', 'Ship on Tuesday Progx'], ['unknown', 'Who pays Progx']]) {
      const input = page.locator(`[data-pro-log="${kindName}"] input`)
      await input.fill(text)
      await input.press('Enter')
      await h.wait(300)
    }
    const log = await k.waitFor(async () => {
      const l = Object.values((await k.ledger()).log).map((r) => r.value).filter((v) => v && v.group === label.id)
      return l.length >= 3 ? l : null
    })
    const kinds = (log ?? []).map((v) => `${v.kind}:${v.text}`).sort()
    await k.check('C: the ledger log holds an issue, a decision and a question of the group', JSON.stringify(kinds) === JSON.stringify(['decision:Ship on Tuesday Progx', 'issue:Printer jams Progx', 'unknown:Who pays Progx']), JSON.stringify(kinds))
    await k.check('C: the issue shows', (await page.locator('[data-pro-issue]').count()) === 1)
    await k.check('C: the decision shows', (await page.locator('[data-pro-decision]').count()) === 1)
    await k.check('C: the question shows', (await page.locator('[data-pro-question]').count()) === 1)
    await h.capture('group-log')

    // --- D. Edit and agenda ------------------------------------------------------------------------------
    await page.locator('[data-pro-edit-group]').click()
    await page.locator('[data-pro-group-name]').waitFor({ timeout: 5000 })
    await page.locator('[data-pro-group-name]').fill('Crew Progx')
    await page.locator('[data-pro-group-save]').click()
    await h.wait(900)
    await k.check('D: the page title follows the rename', ((await page.locator('h1').first().textContent()) ?? '').includes('Crew Progx'))
    await k.check('D: the sidebar row follows the rename', ((await page.locator(`[data-pro-group-nav="${label.id}"]`).textContent()) ?? '').includes('Crew Progx'))
    await k.clearClipboard()
    await page.locator('[data-pro-copy-agenda="weekly"]').click()
    const text = (await k.waitFor(async () => (await k.clipboard()) || null)) ?? ''
    await k.check('D: Copy agenda puts the group name on the clipboard', text.includes('Crew Progx'), text.slice(0, 400))
    await k.check('D: the agenda has an action line', text.includes('site list'), text.slice(0, 600))
    await h.capture('group-page-after')
    await h.axe()
  } finally {
    await k.cleanup({ match })
  }
}
