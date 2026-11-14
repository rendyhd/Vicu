// A routine's history (cross-app semantics 6.11): the summary line, the month of marks, the day
// picked and the weekly bars.
//
// The seed has no routines, so this makes one of its own on the test server ("RHIS stretch", one
// time a day, started 13 days ago: done every day but one missed and one skipped) and deletes it
// at the end, also what a cut-off run left behind.
//
//   A. The History dialog opens from the routine's row and says "3 in a row · 12 of 13 in the last
//      30 days".
//   B. The month marks the days: today is read as done, the missed day as not logged, the skipped
//      day as skipped (a day that falls outside the six weeks shown is not checked).
//   C. Picking the skipped day lists it as Skipped at 08:00.
//   D. The twelve weekly bars are there, named for a screen reader.
import { createApi, localDate, readApiToken } from '../lib.mjs'

export const meta = {
  id: 'RHIS',
  wave: null,
  title: "A routine's history: summary line, month of marks, the day picked, weekly bars",
}

const NAME = 'RHIS stretch'
const ROUTINE_ID = 'rhis1'
const MISSED = -3
const SKIPPED = -5

function carrierDescription() {
  const occurrences = {}
  for (let offset = -13; offset <= 0; offset++) {
    if (offset === MISSED) continue
    const date = localDate(offset)
    const key = `${ROUTINE_ID}:${date}:s1`
    const status = offset === SKIPPED ? 'SKIPPED' : 'COMPLETED'
    const stamp = `${date}T12:00:00.000Z`
    occurrences[key] = {
      key,
      routineId: ROUTINE_ID,
      slotId: 's1',
      scheduledDate: date,
      scheduledMinutes: 480,
      timeZoneId: 'UTC',
      status,
      loggedAt: status === 'COMPLETED' ? stamp : '',
      modifiedAt: stamp,
      modifiedBy: 'ui-verify',
      note: '',
    }
  }
  const start = localDate(-13)
  const payload = {
    version: 1,
    definition: {
      id: ROUTINE_ID,
      name: NAME,
      kind: 'HEALTH',
      healthSubtype: null,
      amount: '',
      unit: '',
      iconName: '',
      color: '#34C759',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: start },
      slots: [{ id: 's1', label: '08:00', period: 'MORNING', reminderMinutes: 480, reminderEnabled: false, followUpMinutes: 0 }],
      activeFrom: start,
      archived: false,
      createdAt: `${start}T08:00:00.000Z`,
      updatedAt: `${start}T08:00:00.000Z`,
      updatedBy: 'ui-verify',
    },
    occurrences,
    prunedBefore: '',
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `<!-- vicu-routine:v1:${encoded} -->`
}

async function removeLeftovers(api) {
  for (const done of ['true', 'false']) {
    const found = await api.list('/tasks', { q: NAME, filter: `done = ${done}` }).catch(() => [])
    for (const task of found) if (task.title === NAME) await api.del(`/tasks/${task.id}`).catch(() => {})
  }
}

export default async function run(h) {
  const api = createApi(readApiToken())
  await removeLeftovers(api)
  await api.post(`/projects/${h.ids.inbox}/tasks`, { title: NAME, description: carrierDescription(), done: true })
  try {
    // The app read its routines when it started: load the page again so it reads the new one.
    await h.page.reload()
    await h.settle(h.page, 1200)
    await h.goto('/routines')
    const row = h.page.locator('button[title="History"]').first()
    await row.waitFor({ state: 'visible', timeout: 15000 })
    await row.click()
    await h.wait(600)
    const dialog = h.page.locator('dialog[open]').last()

    await h.assert('A: the summary line', async () => {
      const text = await dialog.innerText()
      return { ok: text.includes('3 in a row · 12 of 13 in the last 30 days'), detail: text.split('\n').slice(0, 3).join(' | ') }
    })

    const label = async (offset) => {
      const day = dialog.locator(`[data-date="${localDate(offset)}"]`)
      return (await day.count()) > 0 ? day.getAttribute('aria-label') : null
    }
    await h.assert('B: today is read as done', async () => {
      const text = await label(0)
      return { ok: !!text && text.endsWith(', done'), detail: text }
    })
    for (const [offset, words] of [[MISSED, 'not logged'], [SKIPPED, 'skipped']]) {
      const text = await label(offset)
      if (text === null) h.skip(`B: the ${words} day`, 'outside the six weeks shown')
      else await h.assert(`B: the ${words} day is read as ${words}`, () => ({ ok: text.endsWith(`, ${words}`), detail: text }))
    }
    await h.capture('history')

    const skipped = dialog.locator(`[data-date="${localDate(SKIPPED)}"]`)
    if ((await skipped.count()) > 0) {
      await skipped.click()
      await h.wait(250)
      await h.assert('C: the day picked lists what it holds', async () => {
        const text = await dialog.innerText()
        return { ok: /Skipped/.test(text) && !/Nothing scheduled/.test(text), detail: text.split('\n').slice(-4).join(' | ') }
      })
      await h.capture('history-skipped-day')
    } else {
      h.skip('C: the day picked', 'the skipped day is outside the six weeks shown')
    }

    await h.assert('D: twelve weekly bars with a name', async () => {
      const bars = dialog.locator('[role="img"][aria-label^="Last 12 weeks"]')
      return (await bars.count()) === 1
    })
    await h.dismiss()
  } finally {
    await removeLeftovers(api)
  }
}
