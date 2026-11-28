// Vicu Pro, M0: what the Vikunja server does with the fields and relations Pro relies on.
// Run: node scripts/ui-verify/tools/pro-server-checks.mjs (the test server must be up; see the
// harness README). Creates throwaway tasks in the seeded "Trip to Lisbon" project and deletes them.
// Prints one line per check; never prints credentials.
import { createApi, readLocalJson } from '../lib.mjs'

const results = []
const note = (check, outcome) => {
  results.push({ check, outcome })
  console.log(`${check}: ${outcome}`)
}

async function login(file) {
  const creds = readLocalJson(file)
  const api = createApi()
  const res = await api.post('/login', { username: creds.username, password: creds.password, long_token: true })
  api.setToken(res.token)
  return api
}

const a = await login('credentials.json')
const maya = await login('credentials-uimaya.json')
const ids = readLocalJson('seed-ids.json')
const projectId = ids.projects?.lisbon ?? ids.lisbon
const made = []
const task = async (title, extra = {}) => {
  const t = await a.post(`/projects/${projectId}/tasks`, { title: `PRO-M0 ${title}`, ...extra })
  made.push(t.id)
  return t
}

try {
  // 1. Favourites per user, and whether they move `updated`.
  const f = await task('favourite')
  const before = (await a.get(`/tasks/${f.id}`)).updated
  await new Promise((r) => setTimeout(r, 1100))
  await a.patch(`/tasks/${f.id}`, { is_favorite: true })
  const afterA = await a.get(`/tasks/${f.id}`)
  const afterMaya = await maya.get(`/tasks/${f.id}`)
  note('favourite set by merge patch', String(afterA.is_favorite === true))
  note('favourite is per user (Maya sees false)', String(afterMaya.is_favorite === false))
  note('favourite moves updated', String(afterA.updated !== before))
  const favList = await a.list('/tasks', { filter: `project_id = ${projectId}` })
  note('favourite present in collection responses', String(favList.find((t) => t.id === f.id)?.is_favorite === true))

  // 2. A lone start date.
  const start = '2026-12-01T00:00:00+01:00'
  const s = await task('lone start', {})
  await a.patch(`/tasks/${s.id}`, { start_date: new Date(start).toISOString() })
  const s1 = await a.get(`/tasks/${s.id}`)
  note('lone start_date stored', `${s1.start_date} end=${s1.end_date}`)
  await a.patch(`/tasks/${s.id}`, { due_date: '2026-12-05T22:59:59Z' })
  const s2 = await a.get(`/tasks/${s.id}`)
  note('lone start survives a due-date patch', String(s2.start_date === s1.start_date))
  await a.patch(`/tasks/${s.id}`, { start_date: null })
  const s3 = await a.get(`/tasks/${s.id}`)
  note('start_date cleared by null', String(!s3.start_date || s3.start_date.startsWith('0001')))

  // 3. Repeats move a lone start date, per repeat mode.
  for (const mode of [0, 1, 2]) {
    const r = await task(`repeat mode ${mode}`, {
      due_date: '2026-11-20T22:59:59Z',
      start_date: '2026-11-18T23:00:00Z',
      repeat_after: mode === 1 ? 0 : 7 * 86400,
      repeat_mode: mode,
    })
    await a.patch(`/tasks/${r.id}`, { done: true })
    const r2 = await a.get(`/tasks/${r.id}`)
    note(`repeat mode ${mode}: done=${r2.done}`, `due ${r2.due_date} start ${r2.start_date}`)
  }

  // 4. Relations: blocked / blocking, inverse, done flag of the related task, delete.
  const blocker = await task('blocker')
  const blocked = await task('blocked')
  await a.post(`/tasks/${blocked.id}/relations`, { other_task_id: blocker.id, relation_kind: 'blocked' })
  const bd = await a.get(`/tasks/${blocked.id}`)
  const br = await a.get(`/tasks/${blocker.id}`)
  note('blocked relation stored', JSON.stringify(Object.keys(bd.related_tasks ?? {})))
  note('inverse blocking created', JSON.stringify(Object.keys(br.related_tasks ?? {})))
  const entry = (bd.related_tasks?.blocked ?? [])[0]
  note('related entry carries done', `has done field: ${entry ? 'done' in entry : 'no entry'}`)
  const coll = await a.list('/tasks', { filter: `project_id = ${projectId} && done = false` })
  note('related_tasks in collection responses', String(Boolean(coll.find((t) => t.id === blocked.id)?.related_tasks?.blocked?.length)))
  await a.patch(`/tasks/${blocker.id}`, { done: true })
  const bd2 = await a.get(`/tasks/${blocked.id}`)
  note('related entry shows blocker done', String((bd2.related_tasks?.blocked ?? [])[0]?.done))
  await a.del(`/tasks/${blocker.id}`)
  made.splice(made.indexOf(blocker.id), 1)
  const bd3 = await a.get(`/tasks/${blocked.id}`)
  note('deleting the blocker removes the relation', String(!(bd3.related_tasks?.blocked ?? []).length))
  // Same pair twice.
  const x = await task('dup a')
  const y = await task('dup b')
  await a.post(`/tasks/${x.id}/relations`, { other_task_id: y.id, relation_kind: 'blocked' })
  try {
    await a.post(`/tasks/${x.id}/relations`, { other_task_id: y.id, relation_kind: 'blocked' })
    note('adding the same relation twice', 'accepted')
  } catch (e) {
    note('adding the same relation twice', `refused ${e.status} ${e.message.slice(-80)}`)
  }
  await a.del(`/tasks/${x.id}/relations/blocked/${y.id}`)
  try {
    await a.del(`/tasks/${x.id}/relations/blocked/${y.id}`)
    note('removing a missing relation', 'accepted')
  } catch (e) {
    note('removing a missing relation', `refused ${e.status}`)
  }

  // 5. A filter on start dates.
  try {
    const fl = await a.list('/tasks', {
      filter: `project_id = ${projectId} && (start_date < 2026-11-30 || start_date = null)`,
      filter_include_nulls: 'true',
    })
    note('filter on start_date with nulls', `ok, ${fl.length} rows`)
  } catch (e) {
    note('filter on start_date with nulls', `failed ${e.status}`)
  }

  // 6. Description size a carrier can hold.
  const big = await task('size')
  for (const kb of [64, 256, 384, 512]) {
    const text = `<!-- vicu-probe:v1:${'A'.repeat(kb * 1024)} -->`
    try {
      await a.patch(`/tasks/${big.id}`, { description: text })
      const back = await a.get(`/tasks/${big.id}`)
      note(`description of ${kb} KB`, back.description?.length === text.length ? 'stored intact' : `truncated to ${back.description?.length}`)
    } catch (e) {
      note(`description of ${kb} KB`, `refused ${e.status}`)
    }
  }
} finally {
  for (const id of made) {
    try {
      await a.del(`/tasks/${id}`)
    } catch {
      /* already gone */
    }
  }
}
