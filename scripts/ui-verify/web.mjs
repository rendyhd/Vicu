// UI verification for the web version (src/web): the built page (out/web) in a real browser,
// served like the container serves it (web-server.mjs), against the seeded local Vikunja.
//
//   node scripts/ui-verify/web.mjs [--build] [--run NAME] [--theme light|dark] [--size 1280x820]
//                                  [--browser chrome|msedge|<path>] [--headed] [--only a,b]
//                                  [--url http://127.0.0.1:8087]   (a running container instead)
//
// It signs in with the seeded test account (password, then API token), walks the views, makes and
// completes a task, checks a second tab, a reload and what the web version hides, and writes PNG
// captures and one JSON line per assertion to scripts/ui-verify/out/<run>/. Exit code 1 when an
// assertion failed or the page threw. No credential is printed.
//
// A developer tool like desktop.mjs: not packaged, not part of `npm run verify`.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'
import { OUT, REPO, SERVER_URL, createApi, loadOrCreateCredentials, readApiToken, readSeedIds, requireServer } from './lib.mjs'
import { startWebServer } from './web-server.mjs'
import { sidebarScroll, sidebarScrollChecks } from './scenarios/_sidebar-scroll.mjs'

const { values: opt } = parseArgs({
  options: {
    build: { type: 'boolean', default: false },
    run: { type: 'string' },
    theme: { type: 'string', default: 'light' },
    size: { type: 'string', default: '1280x820' },
    browser: { type: 'string', default: process.env.VICU_WEB_BROWSER ?? 'chrome' },
    headed: { type: 'boolean', default: false },
    only: { type: 'string' },
    port: { type: 'string', default: '5176' },
    url: { type: 'string' },
  },
})

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const [WIDTH, HEIGHT] = opt.size.split('x').map(Number)
const RUN = opt.run ?? `web-${opt.theme}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
const RUN_DIR = join(OUT, RUN)
const RESULTS = join(RUN_DIR, 'results.jsonl')

if (!opt.url && (opt.build || !existsSync(join(REPO, 'out', 'web', 'index.html')))) {
  const built = spawnSync('npm', ['run', 'build:web'], { cwd: REPO, stdio: 'inherit', shell: true })
  if (built.status !== 0) process.exit(1)
}

await requireServer()
mkdirSync(RUN_DIR, { recursive: true })
writeFileSync(RESULTS, '')

let failures = 0
function emit(line) {
  appendFileSync(RESULTS, JSON.stringify(line) + '\n')
}
function assert(check, ok, detail = '') {
  if (!ok) failures++
  emit({ check, ok: !!ok, ...(detail ? { detail: String(detail).slice(0, 400) } : {}) })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${check}${!ok && detail ? `: ${String(detail).slice(0, 200)}` : ''}`)
}

const credentials = loadOrCreateCredentials()
const ids = readSeedIds()
const serverApi = createApi(readApiToken())
// --url tests a page that is already served, such as the container; else the built page is served here.
const server = opt.url
  ? { url: opt.url.replace(/\/+$/, ''), close: async () => {} }
  : await startWebServer({ port: Number(opt.port), api: SERVER_URL })
const launch = /[\\/]/.test(opt.browser) ? { executablePath: opt.browser } : { channel: opt.browser }
const browser = await chromium.launch({ ...launch, headless: !opt.headed })
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  colorScheme: opt.theme === 'dark' ? 'dark' : 'light',
  reducedMotion: 'no-preference',
  permissions: ['clipboard-read', 'clipboard-write'],
})

/** What went wrong in a page without an assertion noticing: thrown errors, console errors, failed scripts. */
const problems = []
function watch(page, name) {
  page.on('pageerror', (err) => {
    // A view transition that a newer one replaced rejects its promise; nothing went wrong.
    if (/Transition was skipped/.test(err.message)) return
    problems.push(`${name}: ${err.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // A request the server refuses on purpose (a wrong password, the session check when signed out).
    if (/Failed to load resource: the server responded with a status of (401|403|412)/.test(text)) return
    problems.push(`${name}: ${text}`)
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? ''
    if (failure.includes('ERR_ABORTED')) return
    problems.push(`${name}: ${request.method()} ${new URL(request.url()).pathname} ${failure}`)
  })
}

async function settle(page, extra = 350) {
  const end = Date.now() + 8000
  while (Date.now() < end) {
    const busy = await page.evaluate(() => !!document.querySelector('[class*="animate-spin"], [class*="animate-pulse"], [aria-busy="true"]')).catch(() => false)
    if (!busy) break
    await sleep(100)
  }
  await sleep(extra)
}

async function capture(page, name) {
  await settle(page, 200)
  await page.screenshot({ path: join(RUN_DIR, `web--${name}.png`) })
}

async function goto(page, route) {
  await page.evaluate((hash) => {
    location.hash = hash
  }, `#${route}`)
  await settle(page, 450)
}

const text = (page) => page.evaluate(() => document.body.innerText)
const visible = (page, what, timeout = 8000) => page.getByText(what, { exact: false }).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)

async function openPage(name) {
  const page = await context.newPage()
  watch(page, name)
  await page.goto(server.url)
  await settle(page, 600)
  return page
}

const only = opt.only ? new Set(opt.only.split(',')) : null
const steps = []
const step = (id, run) => steps.push({ id, run })

let page

// --- Setup with a password -----------------------------------------------------------------

step('setup-password', async () => {
  page = await openPage('tab1')
  assert('the page offers a sign-in without asking for a server', await visible(page, 'Sign in with username'), await text(page))
  assert('window.api says it runs in a browser', (await page.evaluate(() => window.api.capabilities.host)) === 'web')
  await capture(page, 'setup')
  await page.getByText('Sign in with username').click()
  await page.getByPlaceholder('Enter your username or email').fill(credentials.username)
  await page.getByPlaceholder('Enter your password').fill(credentials.password)
  await page.keyboard.press('Enter')
  // First-ever sign-in asks for the Inbox; subsequent sign-ins reuse the synced Inbox automatically.
  const reachedAppOrInbox = await Promise.race([
    visible(page, 'Save & Continue', 15000).then((ok) => (ok ? 'inbox' : null)),
    page.locator('nav, aside').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => 'app', () => null),
  ])
  assert('a password sign-in finishes or reaches the Inbox choice', reachedAppOrInbox !== null, await text(page))
  if (reachedAppOrInbox === 'inbox') {
    await capture(page, 'setup-inbox')
    await page.getByText('Save & Continue').click()
  }
  await page.waitForFunction(() => location.hash.includes('inbox') || !!document.querySelector('[data-task-id]'), null, { timeout: 15000 }).catch(() => {})
  await settle(page, 800)
  assert('setup ends in the app', await page.locator('nav, aside').first().isVisible().catch(() => false), await text(page))
  const stored = await page.evaluate(() => JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)]))
  assert('no token is written to page storage by a password sign-in', !/token/i.test(stored) && !/jwt/i.test(stored), stored)
  const session = (await context.cookies()).find((cookie) => cookie.name === 'vikunja_refresh_token')
  assert('the session cookie cannot be read by the page and is not sent from other sites',
    !!session && session.httpOnly === true && ['Lax', 'Strict'].includes(session.sameSite) && session.path.startsWith('/api/'),
    session ? JSON.stringify({ httpOnly: session.httpOnly, sameSite: session.sameSite, path: session.path, secure: session.secure }) : 'no cookie')
  assert('the page cannot see the session cookie', !(await page.evaluate(() => document.cookie)).includes('vikunja_refresh_token'))
})

// --- The views -----------------------------------------------------------------------------

step('views', async () => {
  const views = [
    ['inbox', '/inbox'],
    ['today', '/today'],
    ['upcoming', '/upcoming'],
    ['anytime', '/anytime'],
    ['logbook', '/logbook'],
    ['plan', '/plan'],
    ['review', '/review'],
    ['routines', '/routines'],
    ['project', `/project/${ids.website}`],
    ['settings', '/settings'],
  ]
  for (const [name, route] of views) {
    const before = problems.length
    await goto(page, route)
    await capture(page, name)
    assert(`the ${name} view opens without an error`, problems.length === before, problems.slice(before).join(' | '))
  }
  await goto(page, '/today')
  assert('Today lists the seeded tasks', await visible(page, 'Draft Q4 roadmap'), await text(page))
})

// --- What the web version leaves out ---------------------------------------------------------

step('hidden-features', async () => {
  await goto(page, '/settings')
  const settings = await text(page)
  for (const gone of ['Assistant', 'Quick Entry', 'Launch on startup', 'Vikunja URL']) {
    assert(`Settings shows no "${gone}"`, !settings.includes(gone))
  }
  assert('no Ask button in the sidebar', (await page.locator('button[aria-label="Ask Vicu"]').count()) === 0)
  assert('no custom window controls', (await page.locator('[aria-label="Close window"], [aria-label="Minimize"]').count()) === 0)
})

// --- A task made, changed and completed -------------------------------------------------------

const TASK_TITLE = `Web harness task ${Date.now()}`

async function serverTask(title) {
  const found = await serverApi.get(`/tasks?s=${encodeURIComponent(title)}`).catch(() => null)
  const items = Array.isArray(found) ? found : (found?.items ?? [])
  return items.find((task) => task.title === title) ?? null
}

step('task', async () => {
  await goto(page, '/inbox')
  assert('the Inbox is known after setup (its New task button is there)', (await page.locator('button[aria-label="New task"]').count()) > 0)
  // Alt+N: the browser keeps Ctrl+N for a new window.
  await page.keyboard.press('Alt+KeyN')
  await sleep(500)
  await page.keyboard.type(`${TASK_TITLE} tomorrow`, { delay: 10 })
  await page.keyboard.press('Enter')
  await settle(page, 1500)
  const created = await serverTask(TASK_TITLE)
  assert('a task typed in the composer is on the server', !!created, 'not found by its title')
  assert('its date was read from the text', !!created && !String(created.due_date).startsWith('0001'), created?.due_date)
  await page.keyboard.press('Escape')
  await goto(page, '/upcoming')
  assert('the new task shows in Upcoming', await visible(page, TASK_TITLE), await text(page))
  await capture(page, 'task-created')
})

// --- The Plan screen and Pro (both off until turned on, per browser) ---------------------------

step('plan-and-pro', async () => {
  const today = new Date()
  const at = (hour, minute) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, 0, 0).toISOString()
  // A task with a time block today: its own start and end dates (contract section 16).
  const blocked = await serverApi.post(`/projects/${ids.inbox}/tasks`, {
    title: `Web harness block ${Date.now()}`,
    due_date: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString(),
    start_date: at(15, 0),
    end_date: at(15, 45),
  })
  try {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day', pro_enabled: true }))
    await page.reload()
    await settle(page, 1200)
    const before = problems.length
    await goto(page, '/plan')
    assert('the Plan screen shows its timeline', (await page.locator('[data-plan-scroller]').count()) === 1, await text(page))
    assert('a time block is drawn on it', await page.locator(`[data-plan-block="${blocked.id}"]`).first().waitFor({ timeout: 10000 }).then(() => true, () => false))
    await capture(page, 'plan-screen')
    for (const route of ['/flagged', '/waiting-on', '/people', '/portfolio']) await goto(page, route)
    await capture(page, 'pro-portfolio')
    assert('Plan and the Pro views open without an error', problems.length === before, problems.slice(before).join(' | '))
    // With Pro on in a short window the whole sidebar scrolls as one (also the desktop's sidebar-scroll).
    await page.setViewportSize({ width: WIDTH, height: 560 })
    await goto(page, '/today')
    for (const [name, ok, detail] of sidebarScrollChecks(await sidebarScroll(page))) assert(name, ok, detail)
    await capture(page, 'pro-sidebar-short')
    await page.setViewportSize({ width: WIDTH, height: HEIGHT })
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: false, pro_enabled: false })).catch(() => {})
    await serverApi.del(`/tasks/${blocked.id}`).catch(() => {})
    await page.reload()
    await settle(page, 1000)
  }
})

// --- Work and Personal (cross-app semantics section 22) -------------------------------------

step('work-and-personal', async () => {
  const mode = () => page.evaluate(async () => (await window.api.getConfig())?.work_mode ?? 'all')
  const switchBox = page.locator('[data-work-mode-switch]')
  try {
    await goto(page, '/settings')
    await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
    await sleep(400)
    const card = page.locator('[data-work-mode-settings]')
    assert('Settings, General has the Work and Personal card', (await card.count()) === 1, await text(page))
    assert('the sidebar has no switch while the feature is off', (await switchBox.count()) === 0)
    await card.getByRole('switch').first().click()
    await settle(page, 500)
    assert('turning the feature on shows the switch in the sidebar', await switchBox.waitFor({ timeout: 5000 }).then(() => true, () => false))
    assert('it starts on All', (await page.locator('[data-work-mode="all"]').getAttribute('aria-checked')) === 'true')
    await capture(page, 'work-and-personal-settings')
    await goto(page, '/today')
    await page.locator('[data-work-mode="work"]').click()
    await settle(page, 400)
    assert('clicking Work selects it and saves the mode', (await page.locator('[data-work-mode="work"]').getAttribute('aria-checked')) === 'true' && (await mode()) === 'work', await mode())
    await capture(page, 'work-mode-today')
    await page.keyboard.press('Home')
    await settle(page, 300)
    assert('Home on the switch goes back to All', (await page.locator('[data-work-mode="all"]').getAttribute('aria-checked')) === 'true' && (await mode()) === 'all', await mode())
  } finally {
    await page.evaluate(() => window.api.saveConfigPatch({ work_mode_enabled: false, work_mode: 'all' })).catch(() => {})
    await page.reload()
    await settle(page, 1000)
  }
  assert('with the feature off again the switch is gone', (await switchBox.count()) === 0)
})

// --- Reminders, links and printing under the container's policy ------------------------------

step('page-guards', async () => {
  await goto(page, '/today')
  // No permission was given to this browser, so a reminder shows inside the page.
  const permission = await page.evaluate(() => window.api.notificationPermission())
  assert('the page can ask how notifications stand', ['granted', 'denied', 'default', 'unsupported'].includes(permission), permission)
  if (permission !== 'granted') {
    const shown = await page.evaluate(() => new Promise((done) => {
      const off = window.api.onInPageNotification((notice) => {
        off()
        done(notice)
      })
      setTimeout(() => done(null), 5000)
      void window.api.testNotification()
    }))
    assert('a reminder without permission is shown in the page', !!shown && typeof shown.title === 'string', JSON.stringify(shown))
  }

  // A link in a task's notes opens in another tab; the app stays where it is.
  await context.route('https://example.org/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>elsewhere</p>' }))
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.id = 'harness-link'
    link.href = 'https://example.org/somewhere'
    link.textContent = 'harness link'
    link.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999'
    document.body.appendChild(link)
  })
  const [opened] = await Promise.all([context.waitForEvent('page', { timeout: 8000 }).catch(() => null), page.locator('#harness-link').click()])
  assert('a link to another site opens in a new tab', !!opened && opened.url().startsWith('https://example.org/'), opened?.url())
  assert('the app stays in its tab', page.url().startsWith(server.url) && page.url().includes('#/today'), page.url())
  await opened?.close()
  // A scheme a browser would hand to another program is not followed at all.
  await page.evaluate(() => document.getElementById('harness-link')?.setAttribute('href', 'obsidian://open?vault=a&file=b'))
  const before = context.pages().length
  await page.locator('#harness-link').click()
  await sleep(400)
  assert('an obsidian: link is not followed', context.pages().length === before && page.url().includes('#/today'))
  await page.evaluate(() => document.getElementById('harness-link')?.remove())

  // The print frame loads under the policy (the print dialog itself is not opened here).
  const framed = await page.evaluate(() => new Promise((done) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
    frame.style.display = 'none'
    frame.addEventListener('load', () => {
      const ok = frame.contentDocument?.body?.textContent === 'print me'
      frame.remove()
      done(ok)
    })
    setTimeout(() => done(false), 4000)
    frame.srcdoc = '<p>print me</p>'
    document.body.appendChild(frame)
  }))
  assert('a print frame loads under the page policy', framed === true)

  const headers = await page.evaluate(() => fetch('/', { cache: 'no-store' }).then((r) => [r.headers.get('content-security-policy'), r.headers.get('x-content-type-options')]))
  assert('the page is served with the container policy', typeof headers[0] === 'string' && headers[0].includes("default-src 'self'") && headers[1] === 'nosniff', JSON.stringify(headers))
})

// --- A second tab and a reload ---------------------------------------------------------------

step('tabs', async () => {
  const second = await openPage('tab2')
  assert('a second tab opens signed in', await second.locator('[data-task-id]').first().waitFor({ timeout: 15000 }).then(() => true, () => false), await text(second))
  await goto(second, '/upcoming')
  assert('the second tab lists the task', await visible(second, TASK_TITLE))
  // Completed in the first tab: the second one reads its lists again.
  const created = await serverTask(TASK_TITLE)
  if (created) {
    await goto(page, '/upcoming')
    await page.locator(`[data-task-id="${created.id}"] [role="checkbox"], [data-task-id="${created.id}"] input[type="checkbox"], [data-task-id="${created.id}"] button[aria-label*="omplete"]`).first().click()
    await sleep(2500)
    const after = await serverApi.get(`/tasks/${created.id}`).catch(() => null)
    assert('completing the task reaches the server', after?.done === true, JSON.stringify(after?.done))
    const gone = await second.getByText(TASK_TITLE).first().waitFor({ state: 'hidden', timeout: 12000 }).then(() => true, () => false)
    assert('the second tab drops the completed task without a reload', gone)
    await serverApi.del(`/tasks/${created.id}`).catch(() => {})
  }
  await second.close()

  await page.reload()
  await settle(page, 1200)
  assert('a reload stays signed in (the session cookie renews the session)', await page.locator('[data-task-id]').first().waitFor({ timeout: 15000 }).then(() => true, () => false), await text(page))
})

// --- Sign out, then an API token ---------------------------------------------------------------

step('sign-out', async () => {
  await goto(page, '/settings')
  await page.getByText('Sign Out', { exact: true }).first().click()
  await sleep(500)
  // The question about unsynced work, when it is asked.
  const confirm = page.locator('dialog[open] button', { hasText: 'Sign Out' })
  if (await confirm.count()) await confirm.first().click()
  assert('signing out returns to the sign-in page', await visible(page, 'Sign in with username', 15000), await text(page))
  const session = await page.evaluate(() => fetch('/api/v1/user/token/refresh', { method: 'POST' }).then((r) => r.status))
  assert('the session is over on the server', session !== 200, String(session))
  const left = await page.evaluate(async () => {
    const databases = (await indexedDB.databases?.())?.map((database) => database.name) ?? []
    const config = await new Promise((done) => {
      const open = indexedDB.open('vicu-web')
      open.onerror = () => done(null)
      open.onsuccess = () => {
        try {
          const read = open.result.transaction('documents', 'readonly').objectStore('documents').get('config')
          read.onsuccess = () => done(typeof read.result === 'string' ? JSON.parse(read.result) : null)
          read.onerror = () => done(null)
        } catch {
          done(null)
        }
      }
    })
    // A sync state that was started afresh (a device id and an empty document) holds nothing of the account.
    const holdsSomething = (value) => {
      if (value === undefined || value === null || value === '' || value === false) return false
      if (Array.isArray(value)) return value.some(holdsSomething)
      if (typeof value === 'object') return Object.entries(value).some(([key, inner]) => !['device_id', 'version', 'updated_at', 'dirty'].includes(key) && holdsSomething(inner))
      return true
    }
    const kept = config
      ? ['custom_lists', 'custom_lists_sync', 'synced_prefs_sync', 'pro_ledger_sync', 'saved_filters', 'known_user', 'account_owner', 'api_token', 'last_username']
          .filter((key) => holdsSomething(key === 'custom_lists_sync' ? config[key]?.document?.lists : config[key]))
      : []
    return { databases, kept, inbox: config?.inbox_project_id ?? 0, session: Object.keys(sessionStorage), local: Object.keys(localStorage) }
  })
  assert('signing out leaves none of the account in the browser', left.kept.length === 0 && left.inbox === 0 && !left.session.includes('vicu-web-api-token'), JSON.stringify(left))
  assert('the browser holds no database but the settings', left.databases.every((name) => name === 'vicu-web'), JSON.stringify(left.databases))
})

step('setup-token', async () => {
  const token = readApiToken()
  if (!token) return assert('an API token is seeded', false, 'scripts/ui-verify/.local/api-token.txt is missing')
  await page.getByText('Use API Token instead').click()
  await page.getByPlaceholder('Enter your API token').fill(token)
  await page.getByRole('button', { name: 'Test Connection' }).click()
  // The account already has a synced Inbox from the password sign-in above, so Setup remembers it.
  const reachedApp = await page.locator('nav, aside').first().waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)
  assert('an API-token sign-in remembers the synced Inbox and enters the app', reachedApp, await text(page))
  await settle(page, 1500)
  await goto(page, '/today')
  assert('an API-token setup ends in the app', await page.locator('[data-task-id]').first().waitFor({ timeout: 15000 }).then(() => true, () => false), await text(page))
  const kept = await page.evaluate(() => [sessionStorage.getItem('vicu-web-api-token') !== null, localStorage.getItem('vicu-web-remember-token')])
  assert('the token is kept for this tab only unless asked', kept[0] === true && kept[1] === null, JSON.stringify(kept))
  await goto(page, '/settings')
  await page.getByRole('button', { name: 'Disconnect' }).first().click()
  await sleep(500)
  const confirm = page.locator('dialog[open] button', { hasText: /Disconnect|Sign Out/ })
  if (await confirm.count()) await confirm.first().click()
  await visible(page, 'Use API Token instead', 15000)
  assert('signing out forgets the token', (await page.evaluate(() => sessionStorage.getItem('vicu-web-api-token'))) === null)
})

try {
  for (const { id, run } of steps) {
    if (only && !only.has(id)) continue
    emit({ step: id })
    console.log(`\n# ${id}`)
    try {
      await run()
    } catch (err) {
      assert(`${id} ran to its end`, false, err instanceof Error ? err.message : err)
      if (page) await page.screenshot({ path: join(RUN_DIR, `web--${id}-failed.png`) }).catch(() => {})
    }
  }
  assert('no page error, console error or failed request', problems.length === 0, problems.join(' | '))
} finally {
  await browser.close().catch(() => {})
  await server.close().catch(() => {})
}

console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} check(s) failed`}: ${RUN_DIR}`)
process.exit(failures === 0 ? 0 : 1)
