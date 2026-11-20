// Shared helpers of the Pro groups scenarios (pro-groups, pro-session, pro-follow-ups, pro-weekly-note):
// throwaway people and groups, ledger reads and writes, the clipboard, and the clean-up.

export const list = (value) => (Array.isArray(value) ? value : (value?.items ?? []))
export const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local 23:59:59 of today plus `offset` days, the way a date-only due is stored. */
export const dueAt = (offset = 0) => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, 23, 59, 59).toISOString()
}

export function kit(h, tag) {
  const page = h.page
  const state = { labels: [], tasks: [], settings: null }

  /** The test server's SQLite answers a write made while another runs with a 500: try again. */
  const retry = async (fn, tries = 8) => {
    for (let i = 0; ; i++) {
      try {
        return await fn()
      } catch (error) {
        if (i >= tries - 1) throw error
        await h.wait(400)
      }
    }
  }
  /** An assertion with its detail: check(label, ok, detail). */
  const check = (label, ok, detail) => h.assert(label, { ok: !!ok, detail })
  const ledger = async () => (await page.evaluate(() => window.api.getProLedger())).ledger
  const mutate = (operations) => page.evaluate((ops) => window.api.mutateProLedger(ops), operations)
  const waitFor = async (fn, tries = 40, gap = 200) => {
    for (let i = 0; i < tries; i++) {
      const value = await fn()
      if (value) return value
      await h.wait(gap)
    }
    return null
  }
  const findTask = async (title) => list(await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`)).find((task) => task.title === title) ?? null
  const waitTask = (title) => waitFor(() => findTask(title))
  const promiseOf = (taskId) => waitFor(async () => (await ledger()).promises[String(taskId)]?.value ?? null)
  const prefs = () => page.evaluate(() => window.api.getSyncedPrefs()).then((p) => p.values)

  const makeLabel = async (title) => {
    const label = await retry(() => h.api('POST', '/labels', { title }))
    state.labels.push(label)
    return label
  }
  const makePerson = async (title) => {
    const label = await makeLabel(title)
    await page.evaluate((id) => window.api.setSyncedPreferences({ [`label_kind.${id}`]: 'person' }), label.id)
    return label
  }
  /** A group the way the dialog writes it: a meeting record with a label, and the label marked. */
  const makeGroup = async ({ name, label, people, checks = true, kinds = ['weekly'] }) => {
    const id = `g${tag.toLowerCase()}${Math.random().toString(36).slice(2, 8)}`
    const value = { name, label: label.id, people: people.map((p) => p.id), sessions: kinds.map((kind) => ({ id: `s${kind}${id}`.slice(0, 40), kind })) }
    if (!checks) value.checks = false
    await mutate([{ op: 'set', collection: 'meetings', id, value }])
    await page.evaluate((labelId) => window.api.setSyncedPreferences({ [`label_kind.${labelId}`]: 'group' }), label.id)
    return { id, ...value }
  }
  /** A task through the API (title carries the tag), with the label ids, and optionally a due offset in days. */
  const makeTask = async (title, { labels = [], due = null, done = false } = {}) => {
    const inbox = (await page.evaluate(() => window.api.getConfig())).inbox_project_id
    const task = await h.api('POST', `/projects/${inbox}/tasks`, { title, ...(due === null ? {} : { due_date: dueAt(due) }) })
    state.tasks.push(task.id)
    for (const label of labels) await retry(() => h.api('POST', `/tasks/${task.id}/labels`, { label_id: label.id }))
    if (done) await retry(() => h.api('PATCH', `/tasks/${task.id}`, { done: true }))
    return task
  }
  const setPromise = (taskId, value) => mutate([{ op: 'set', collection: 'promises', id: String(taskId), value }])

  const clipboard = () => h.app.evaluate(({ clipboard: c }) => c.readText())
  const clearClipboard = () => h.app.evaluate(({ clipboard: c }) => c.clear())

  const start = async () => {
    state.settings = (await ledger()).settings?.value ?? null
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: true, pro_onboarding_seen: true, pro_list_views: {}, pro_followup_dismissed: {} }))
    await page.reload()
    await h.wait(1500)
    await page.keyboard.press('F5')
    await h.wait(1200)
  }
  const refresh = async () => {
    await page.keyboard.press('F5')
    await h.wait(1300)
  }

  const cleanTasks = async () => {
    for (const stale of list(await h.api('GET', `/tasks?q=${encodeURIComponent(tag)}&per_page=200`).catch(() => []))) {
      if (String(stale.title).includes(tag)) await h.api('DELETE', `/tasks/${stale.id}`).catch(() => {})
    }
  }
  /** Removes what the run made: tasks, labels, preferences, ledger records of its groups, settings. */
  const cleanup = async ({ match }) => {
    await cleanTasks()
    const found = list(await h.api('GET', '/labels?per_page=200').catch(() => [])).filter((label) => match(String(label.title)))
    const ids = new Set([...state.labels.map((l) => l.id), ...found.map((l) => l.id)])
    const led = await ledger().catch(() => null)
    const operations = []
    if (led) {
      const meetings = Object.entries(led.meetings ?? {}).filter(([, r]) => r.value && ids.has(r.value.label))
      const meetingIds = new Set(meetings.map(([id]) => id))
      for (const [id] of meetings) operations.push({ op: 'set', collection: 'meetings', id, value: null })
      for (const [id, r] of Object.entries(led.rounds ?? {})) if (r.value && meetingIds.has(r.value.meeting)) operations.push({ op: 'set', collection: 'rounds', id, value: null })
      for (const [id, r] of Object.entries(led.log ?? {})) if (r.value && ids.has(r.value.group)) operations.push({ op: 'set', collection: 'log', id, value: null })
      for (const id of state.tasks) if (led.promises?.[String(id)]?.value) operations.push({ op: 'set', collection: 'promises', id: String(id), value: null })
      for (const [id, r] of Object.entries(led.promises ?? {})) if (r.value && typeof r.value.person === 'number' && ids.has(r.value.person)) operations.push({ op: 'set', collection: 'promises', id, value: null })
      operations.push({ op: 'settings', value: state.settings ?? {} })
    }
    if (operations.length) await mutate(operations).catch(() => {})
    for (const id of ids) await h.api('DELETE', `/labels/${id}`).catch(() => {})
    const keys = {}
    for (const id of ids) keys[`label_kind.${id}`] = null
    if (ids.size) await page.evaluate((k) => window.api.setSyncedPreferences(k), keys).catch(() => {})
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {}, pro_followup_dismissed: {} })).catch(() => {})
  }

  return { state, check, ledger, mutate, waitFor, findTask, waitTask, promiseOf, prefs, makeLabel, makePerson, makeGroup, makeTask, setPromise, clipboard, clearClipboard, start, refresh, cleanTasks, cleanup }
}
