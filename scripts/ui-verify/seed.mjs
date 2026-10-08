// Seeds (or re-seeds) the local Vikunja test server with the design-review dataset.
//
//   node scripts/ui-verify/seed.mjs
//
// Idempotent: it makes sure the test user and an API token exist, deletes that user's projects,
// tasks and labels (the default Inbox project stays, emptied), and re-creates the dataset with
// every date relative to today. Credentials, the token and the created ids go to
// scripts/ui-verify/.local/ (git-ignored); nothing secret is printed. After a re-seed, run
// profile.mjs again (the Inbox id may have changed) - desktop.mjs does that on its own.
import {
  at,
  createApi,
  dateOnly,
  ensureApiToken,
  ensureUserAndLogin,
  localDate,
  writeLocal,
} from './lib.mjs'

// Vikunja's preset colours (the colour picker of its web app).
const PRESET = {
  amber: 'ffbe0b',
  orange: 'fd8a09',
  pink: 'ff006e',
  violet: '8338ec',
  blue: '3a86ff',
  sky: '4c91ff',
  green: '0ead69',
  slate: '373f47',
}

const { jwt, creds } = await ensureUserAndLogin()
const api = createApi(jwt)
const token = await ensureApiToken(jwt)
console.log(`logged in as the test user; time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}`)

// --- Clean the account ---------------------------------------------------------------------

const me = await api.get('/user')
const defaultProjectId = me.settings?.default_project_id ?? 0

async function removeQuietly(path) {
  try {
    await api.del(path)
  } catch (e) {
    if (e.status !== 404) throw e
  }
}

const allProjects = (await api.list('/projects', { is_archived: 'true' })).filter((p) => p.id > 0)
const defaultProject = allProjects.find((p) => p.id === defaultProjectId)
for (const p of allProjects) {
  if (p.id !== defaultProject?.id) await removeQuietly(`/projects/${p.id}`)
}
for (const l of await api.list('/labels')) await removeQuietly(`/labels/${l.id}`)

let inbox = defaultProject
if (inbox) {
  for (const done of ['false', 'true']) {
    for (const t of await api.list('/tasks', { filter: `project_id = ${inbox.id} && done = ${done}` })) {
      await removeQuietly(`/tasks/${t.id}`)
    }
  }
  if (inbox.title !== 'Inbox' || inbox.description) {
    inbox = await api.patch(`/projects/${inbox.id}`, { title: 'Inbox', description: '' })
  }
} else {
  inbox = await api.post('/projects', { title: 'Inbox' })
}

// --- Build the dataset ---------------------------------------------------------------------

const labelDefs = [
  ['errand', PRESET.orange],
  ['deep work', PRESET.violet],
  ['waiting', PRESET.slate],
  ['quick win', PRESET.green],
  ['call', PRESET.blue],
]
const labels = {}
for (const [title, hex_color] of labelDefs) labels[title] = await api.post('/labels', { title, hex_color })

/** The review footer Vicu writes at the end of a project description. */
const review = (body, state) => `${body}\n\n---\n**Vicu review**: ${state}`

async function project(title, hex_color, parent = 0, description = '') {
  return api.post('/projects', { title, hex_color, parent_project_id: parent, description })
}
const work = await project('Work', PRESET.blue, 0, review('Everything for the day job.', localDate(-9)))
const personal = await project('Personal', PRESET.pink, 0, review('Life outside work.', 'excluded'))
const website = await project('Website redesign', PRESET.violet, work.id, review('Marketing site and pricing pages.', localDate(-2)))
const q4 = await project('Q4 planning', PRESET.green, work.id, review('Roadmap and budget for the quarter.', 'never'))
const home = await project('Home renovation', PRESET.orange, personal.id, review('Kitchen, hallway and the small repairs.', localDate(-20)))
const lisbon = await project('Trip to Lisbon', PRESET.sky, personal.id, review('Five days in November.', `${localDate(-4)} \u00b7 every 30 days`))

const named = {}
async function task(projectId, title, opts = {}) {
  const { labels: lbls = [], done = false, key, ...rest } = opts
  const t = await api.post(`/projects/${projectId}/tasks`, { title, ...rest })
  for (const l of lbls) await api.post(`/tasks/${t.id}/labels`, { label_id: labels[l].id })
  if (done) await api.patch(`/tasks/${t.id}`, { done: true }) // the server stamps done_at with now
  if (key) named[key] = t.id
  return t
}
async function subtask(parent, title, opts = {}) {
  const t = await task(parent.project_id, title, opts)
  await api.post(`/tasks/${parent.id}/relations`, { other_task_id: t.id, relation_kind: 'subtask' })
  return t
}

const checklist =
  '<ul data-type="taskList">' +
  ['Oat milk', 'Sourdough', 'Tomatoes', 'Coffee beans']
    .map(
      (x, i) =>
        `<li data-checked="${i === 0}" data-type="taskItem"><label><input type="checkbox"${i === 0 ? ' checked="checked"' : ''}><span></span></label><div><p>${x}</p></div></li>`,
    )
    .join('') +
  '</ul>'

// Overdue and today
await task(personal.id, 'Renew passport', { due_date: dateOnly(-2), priority: 4, labels: ['errand'] })
await task(website.id, 'Review pull request from Sam', { due_date: dateOnly(-1), labels: ['deep work'] })
const roadmap = await task(q4.id, 'Draft Q4 roadmap', {
  key: 'roadmap',
  due_date: dateOnly(0),
  priority: 3,
  labels: ['deep work'],
  description:
    '<p>Outline the three big bets for Q4 and the metric that tells us each one worked.</p><ul><li><p>Growth: self-serve onboarding</p></li><li><p>Retention: weekly review flow</p></li></ul>',
})
await task(home.id, 'Call the plumber about the kitchen leak', {
  due_date: at(0, 14, 0, 0),
  labels: ['call'],
  reminders: [{ reminder: at(0, 13, 45, 0) }],
})
await task(personal.id, 'Buy groceries', { key: 'groceries', due_date: dateOnly(0), labels: ['errand'], description: checklist })
await task(personal.id, 'Water the plants', { due_date: dateOnly(0), repeat_after: 3 * 86400 })
await task(lisbon.id, 'Book flights to Lisbon', { due_date: dateOnly(0), priority: 2 })
await task(personal.id, 'Send the signed lease back to the landlord', { due_date: dateOnly(0), priority: 5 })

// Upcoming
await task(personal.id, 'Dentist appointment', { due_date: at(1, 9, 30, 0), reminders: [{ reminder: at(1, 8, 30, 0) }] })
await task(work.id, 'Send invoice to Northwind', { due_date: dateOnly(2), labels: ['quick win'] })
await task(work.id, 'Team retrospective', { due_date: at(2, 15, 0, 0), repeat_after: 7 * 86400 })
await task(home.id, 'Pay the electricity bill', { due_date: dateOnly(5), priority: 2 })
await task(personal.id, "Mom's birthday dinner", { due_date: at(11, 19, 0, 0), labels: ['call'] })
await task(personal.id, 'Renew gym membership', { due_date: dateOnly(24) })
await task(personal.id, 'Plan holiday gifts', { due_date: dateOnly(44), labels: ['errand'] })

// Anytime, per project
await task(website.id, 'Audit colour contrast on the pricing page', { labels: ['quick win'] })
await task(website.id, 'Collect three customer testimonials', { labels: ['waiting'] })
const migrate = await task(website.id, 'Migrate the blog to the new CMS', { priority: 2 })
await task(website.id, 'Write the launch announcement')
await task(q4.id, 'Interview three customers about onboarding', { labels: ['call'] })
await task(q4.id, 'Budget review with finance', { labels: ['waiting'] })
await task(q4.id, 'Prepare the quarterly stakeholder update with the revised roadmap, the budget forecast and the staffing plan')
await task(home.id, 'Get quotes for the kitchen tiles', { priority: 1 })
await task(home.id, 'Choose paint colours for the hallway', { labels: ['waiting'] })
await task(home.id, 'Fix the squeaky bedroom door', { labels: ['quick win'] })
await task(lisbon.id, 'Research a day trip to Sintra')
await task(lisbon.id, 'Reserve dinner at a tasca in Alfama', { labels: ['call'] })
await task(lisbon.id, 'Make a packing list')

// Inbox
await task(inbox.id, 'Look into standing desks')
await task(inbox.id, 'Reply to Ana about the weekend', { labels: ['quick win'] })
await task(inbox.id, 'Idea: a weekly review template')
await task(inbox.id, 'Cancel the unused streaming subscription')

// Subtasks
await subtask(roadmap, 'List the candidate bets', { done: true })
await subtask(roadmap, 'Estimate effort with the team')
await subtask(roadmap, 'Share the draft with leadership')
await subtask(migrate, 'Export posts from the old CMS', { done: true })
await subtask(migrate, 'Set up redirects')

// Logbook (every finished task is stamped with the time of the run)
for (const [p, title] of [
  [work.id, 'Submit expense report'],
  [personal.id, 'Order new running shoes'],
  [home.id, 'Clean out the garage'],
  [q4.id, 'Collect Q3 metrics'],
  [lisbon.id, 'Renew travel insurance'],
]) {
  await task(p, title, { done: true })
}

writeLocal('seed-ids.json', {
  seededOn: localDate(0),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  inbox: inbox.id,
  work: work.id,
  personal: personal.id,
  website: website.id,
  q4: q4.id,
  home: home.id,
  lisbon: lisbon.id,
  labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.id])),
  tasks: named,
})

const tasks = await api.list('/tasks', { filter: 'done = false' })
console.log(`seeded: 7 projects, ${labelDefs.length} labels, ${tasks.length} open tasks; Inbox project id ${inbox.id}`)
console.log(`credentials, token and ids are in scripts/ui-verify/.local/ (token ${token && creds ? 'ready' : 'missing'})`)
