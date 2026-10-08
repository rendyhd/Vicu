// Desktop UI verification harness: launches the built Vicu with playwright-core, runs scenarios
// against the seeded local test server and writes captures plus one JSON line per assertion.
//
//   npm run ui:verify -- --scenario baseline --theme light
//   npm run ui:verify -- --wave 1 --theme dark --size 900x600
//
// Options
//   --theme light|dark         profile theme (default light)
//   --size WxH                 content size of the main window (default 1280x820)
//   --motion full|reduce       full (default) forces prefers-reduced-motion: no-preference, because
//                              this PC reports reduce; reduce emulates it
//   --forced-colors            emulate forced-colors: active
//   --scenario a,b             scenarios by file name or id (baseline, e4, e04-schedule-popover)
//   --wave N                   every E scenario whose first wave is N or earlier
//   --run NAME                 output folder name under scripts/ui-verify/out/ (default: stamp+label)
//   --build                    run `npm run build` first
//   --list                     list the scenarios and exit
//
// Needs: the test server (README.md), `node scripts/ui-verify/seed.mjs` once, and a built app
// (`npm run build`). Exit code 1 when a scenario threw or an assertion failed.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from 'playwright-core'
import { HERE, OUT, REPO, createApi, localDate, readApiToken, readSeedIds, requireServer } from './lib.mjs'
import { writeProfile } from './profile.mjs'

const require = createRequire(import.meta.url)

// --- Options -------------------------------------------------------------------------------

const { values: opt } = parseArgs({
  options: {
    theme: { type: 'string', default: 'light' },
    size: { type: 'string', default: '1280x820' },
    motion: { type: 'string', default: 'full' },
    'forced-colors': { type: 'boolean', default: false },
    scenario: { type: 'string' },
    wave: { type: 'string' },
    run: { type: 'string' },
    build: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
  },
  strict: true,
})

const sizeMatch = /^(\d+)x(\d+)$/.exec(opt.size)
if (!sizeMatch) fail(`--size must look like 1280x820, got "${opt.size}"`)
if (!['light', 'dark'].includes(opt.theme)) fail(`--theme must be light or dark, got "${opt.theme}"`)
if (!['full', 'reduce'].includes(opt.motion)) fail(`--motion must be full or reduce, got "${opt.motion}"`)
const SIZE = { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) }

function fail(message) {
  console.error(message)
  process.exit(2)
}

// --- Scenarios -----------------------------------------------------------------------------

async function loadScenarios() {
  const dir = join(HERE, 'scenarios')
  const out = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_')).sort()) {
    const mod = await import(pathToFileURL(join(dir, file)).href)
    if (!mod.meta || typeof mod.default !== 'function') fail(`scenarios/${file} must export meta and a default function`)
    out.push({ name: file.replace(/\.mjs$/, ''), meta: mod.meta, run: mod.default })
  }
  return out
}

const idNumber = (s) => Number(/\d+/.exec(s.meta.id)?.[0] ?? 0)
const all = await loadScenarios()

if (opt.list) {
  for (const s of all) console.log(`${s.meta.id.padEnd(9)} wave ${String(s.meta.wave ?? '-').padEnd(2)} ${s.name}  ${s.meta.title}`)
  process.exit(0)
}

let selected
let label
if (opt.scenario) {
  const wanted = opt.scenario.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  selected = wanted.map((w) => {
    const hit = all.find((s) => s.name.toLowerCase() === w || s.meta.id.toLowerCase() === w)
    if (!hit) fail(`Unknown scenario "${w}". Try --list.`)
    return hit
  })
  label = wanted.join('+')
} else if (opt.wave !== undefined) {
  const wave = Number(opt.wave)
  if (!Number.isInteger(wave) || wave < 0) fail(`--wave must be a whole number, got "${opt.wave}"`)
  selected = all.filter((s) => typeof s.meta.wave === 'number' && s.meta.wave <= wave).sort((a, b) => idNumber(a) - idNumber(b))
  label = `wave${wave}`
} else {
  selected = all.filter((s) => s.name === 'baseline')
  label = 'baseline'
}
const WAVE = opt.wave === undefined ? null : Number(opt.wave)

// --- Run folder and result lines -----------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0')
const now = new Date()
const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
const runName = opt.run ?? `${stamp}-${label}-${opt.theme}`
const RUN_DIR = join(OUT, runName)
mkdirSync(RUN_DIR, { recursive: true })
const RESULTS = join(RUN_DIR, 'results.jsonl')
writeFileSync(RESULTS, '')

const tally = { captures: 0, pass: 0, fail: 0, errors: 0, axe: 0 }
let currentScenario = '-'

/** One JSON object per line, on stdout and in results.jsonl. */
function emit(obj) {
  const line = JSON.stringify({ scenario: currentScenario, ...obj })
  console.log(line)
  appendFileSync(RESULTS, line + '\n')
}

// --- Build check ---------------------------------------------------------------------------

function newestMtime(dir) {
  let newest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue // tests are not part of the build
    const p = join(dir, entry.name)
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs)
  }
  return newest
}

if (opt.build) {
  const res = spawnSync('npm run build', { cwd: REPO, stdio: 'inherit', shell: true })
  if (res.status !== 0) fail('npm run build failed')
}
for (const rel of ['out/main/index.js', 'out/renderer/index.html']) {
  if (!existsSync(join(REPO, rel))) fail(`${rel} is missing: run \`npm run build\` first (or pass --build).`)
}
{
  const built = statSync(join(REPO, 'out/main/index.js')).mtimeMs
  if (newestMtime(join(REPO, 'src')) > built) {
    emit({ t: 'warn', message: 'src/ has files newer than out/; the captures show the last build. Run npm run build (or pass --build).' })
  }
}

await requireServer()
const ids = readSeedIds()
if (ids.seededOn !== localDate(0)) {
  emit({ t: 'warn', message: `the seed is from ${ids.seededOn}, not today; run node scripts/ui-verify/seed.mjs so dates line up.` })
}

// --- Launch --------------------------------------------------------------------------------

const profile = await writeProfile(opt.theme, { size: SIZE })
// The main process logs the URL of every request it starts (request-log.cjs, test-only), for the
// scenarios that count requests (h.requests()).
const REQUEST_LOG = join(RUN_DIR, 'main-requests.jsonl')
writeFileSync(REQUEST_LOG, '')
const requestLogModule = join(HERE, 'request-log.cjs')
const app = await electron.launch({
  executablePath: require('electron'),
  // Device scale 1 for predictable pixels; the GitHub release check is cut off so no update banner
  // or outside traffic can show up in a capture.
  args: ['--require', requestLogModule, '.', '--force-device-scale-factor=1', '--host-resolver-rules=MAP api.github.com ~NOTFOUND'],
  cwd: REPO,
  env: {
    ...process.env,
    VICU_USER_DATA_DIR: profile,
    VICU_UI_REQUEST_LOG: REQUEST_LOG,
  },
  timeout: 60000,
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Quits the app and its helper processes. app.exit() ends everything at once (a plain kill leaves
 * the GPU and network helpers holding the profile folder for a while); the process tree is killed
 * if the app has not gone after a few seconds.
 */
async function shutdown() {
  const proc = app.process()
  if (proc.exitCode !== null) return
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {})
  await Promise.race([exited, sleep(8000)])
  if (proc.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    else proc.kill('SIGKILL')
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    void shutdown().finally(() => process.exit(130))
  })
}
const state = { motion: opt.motion, forcedColors: opt['forced-colors'] }

async function applyMedia(page) {
  await page.emulateMedia({
    reducedMotion: state.motion === 'reduce' ? 'reduce' : 'no-preference',
    forcedColors: state.forcedColors ? 'active' : 'none',
  })
}

const watched = new WeakSet()
function watch(page) {
  if (watched.has(page)) return
  watched.add(page)
  page.on('pageerror', (e) => {
    tally.errors++
    emit({ t: 'pageerror', message: String(e.message ?? e).split('\n')[0] })
  })
  page.on('console', (m) => {
    if (m.type() === 'error') emit({ t: 'console', level: 'error', text: m.text().slice(0, 300) })
  })
}

async function waitForWindow(match, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const page = app.windows().find((w) => match(w.url()))
    if (page) {
      watch(page)
      return page
    }
    await sleep(150)
  }
  return null
}

const isMain = (u) => u.includes('/renderer/index.html')
const page = await waitForWindow(isMain)
if (!page) {
  await shutdown()
  fail('The main window did not open.')
}
await page.waitForLoadState('domcontentloaded')
await applyMedia(page)

async function setSize(width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/renderer/index.html'))
    if (!win) return
    win.setPosition(0, 0)
    win.setContentSize(w, h)
  }, [width, height])
  await sleep(300)
}
await setSize(SIZE.width, SIZE.height)

// --- Helpers handed to scenarios -----------------------------------------------------------

const token = readApiToken()
const serverApi = createApi(token)

// Stale content: a task that was completed or deleted after the seed changes what the captures show,
// even when the seed is from today. seed.mjs keys the tasks that scenarios rely on.
{
  const gone = []
  for (const [key, id] of Object.entries(ids.tasks ?? {})) {
    const task = await serverApi.get(`/tasks/${id}`).catch(() => null)
    if (!task || task.done) gone.push(key)
  }
  if (gone.length > 0) {
    emit({ t: 'warn', message: `seeded tasks are missing or done (${gone.join(', ')}); run node scripts/ui-verify/seed.mjs to re-seed.` })
  }
}

function isSelector(s) {
  return /^(css|text|role|xpath|id|data-testid|internal:)[:=]/.test(s) || /^[.#[]/.test(s) || s.startsWith('//') || /[[\]>]/.test(s) || /^[a-z]+\./.test(s)
}

/** A Playwright locator from a locator, a CSS/engine selector, or visible text (exact match). */
function target(p, t) {
  if (typeof t !== 'string') return t
  return isSelector(t) ? p.locator(t).first() : p.getByText(t, { exact: true }).first()
}

async function settle(p = page, extra = 350) {
  const end = Date.now() + 8000
  while (Date.now() < end) {
    const busy = await p.evaluate(() => !!document.querySelector('[class*="animate-spin"], [class*="animate-pulse"], [aria-busy="true"]')).catch(() => false)
    if (!busy) break
    await sleep(100)
  }
  await p.evaluate(() => document.fonts?.ready).catch(() => {})
  await sleep(extra)
}

let axeSource = null

const h = {
  app,
  page,
  options: { ...opt, size: SIZE, wave: WAVE },
  ids,
  runDir: RUN_DIR,
  get motion() {
    return state.motion
  },
  get today() {
    return new Date()
  },
  emit,
  settle,
  wait: (ms) => sleep(ms),

  /** Opens a route of the main window: goto('/today'), goto('#/project/12'). */
  async goto(route) {
    const hash = route.startsWith('#') ? route : `#${route.startsWith('/') ? '' : '/'}${route}`
    await page.evaluate((x) => {
      location.hash = x
    }, hash)
    await settle(page, 450)
  },

  async click(t, options = {}) {
    await target(page, t).click(options)
    await sleep(120)
  },
  async rightClick(t) {
    await target(page, t).click({ button: 'right' })
    await sleep(120)
  },
  key: async (combo, options) => page.keyboard.press(combo, options),
  type: async (text, { delay = 25 } = {}) => page.keyboard.type(text, { delay }),
  async hover(t) {
    await target(page, t).hover()
    await sleep(120)
  },

  /** Real pointer drag from one target to another (or to {x, y}); `hold` leaves the button down. */
  async drag(from, to, { steps = 14, hold = false } = {}) {
    const a = await target(page, from).boundingBox()
    if (!a) throw new Error('drag: the source has no box')
    const b = to && typeof to.x === 'number' ? { x: to.x, y: to.y, width: 0, height: 0 } : await target(page, to).boundingBox()
    if (!b) throw new Error('drag: the target has no box')
    const x0 = a.x + a.width / 2
    const y0 = a.y + a.height / 2
    await page.mouse.move(x0, y0)
    await page.mouse.down()
    await page.mouse.move(x0, y0 + 4, { steps: 2 })
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps })
    if (!hold) await page.mouse.up()
  },
  mouseUp: () => page.mouse.up(),

  /**
   * Closes whatever is open: popovers, menus, the composer and an expanded card. Escape first, then
   * a click on the view heading (a click outside collapses a card), then Escape again.
   */
  async dismiss() {
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(120)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(120)
    await page.locator('h1').first().click({ position: { x: 4, y: 4 }, timeout: 1500 }).catch(() => {})
    await sleep(120)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(200)
  },

  /** All task rows and cards of the current view, in order. */
  rows: () => page.locator('[data-task-id]'),
  lastRow: () => page.locator('[data-task-id]').last(),

  async resize(width, height) {
    await setSize(width, height)
    await settle(page, 200)
  },
  async setMotion(mode) {
    state.motion = mode
    for (const w of app.windows()) await applyMedia(w).catch(() => {})
  },
  async setForcedColors(on) {
    state.forcedColors = on
    for (const w of app.windows()) await applyMedia(w).catch(() => {})
  },

  /** Saves a PNG at device scale 1: capture('today', { clip, page, transparent }). */
  async capture(name, { clip, page: p = page, transparent = false } = {}) {
    const safe = String(name).replace(/[^a-zA-Z0-9._-]+/g, '-')
    const file = join(RUN_DIR, `${currentScenario}--${safe}.png`)
    let region = clip
    if (clip && typeof clip.boundingBox === 'function') region = (await clip.boundingBox()) ?? undefined
    await p.screenshot({ path: file, clip: region, omitBackground: transparent })
    tally.captures++
    emit({ t: 'capture', name: safe, file: `${currentScenario}--${safe}.png` })
    return file
  },

  /** One result line per assertion. `fn` returns a boolean or { ok, detail }; a throw is a failure. */
  async assert(label, fn) {
    let ok = false
    let detail
    try {
      const res = await (typeof fn === 'function' ? fn() : fn)
      if (res && typeof res === 'object') {
        ok = !!res.ok
        detail = res.detail
      } else {
        ok = !!res
      }
    } catch (e) {
      ok = false
      detail = String(e.message ?? e).split('\n')[0]
    }
    if (ok) tally.pass++
    else tally.fail++
    emit({ t: 'assert', label, ok, ...(detail === undefined ? {} : { detail }) })
    return ok
  },

  /** Runs axe-core on the page (or inside `selector`); one line per violation; returns them all. */
  async axe(selector, { page: p = page, label = selector ?? 'page' } = {}) {
    axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
    // CDP evaluation is not bound by the page's Content-Security-Policy; a script tag would be.
    if (!(await p.evaluate(() => typeof window.axe !== 'undefined'))) await p.evaluate(axeSource)
    const result = await p.evaluate(async (sel) => {
      const context = sel ? { include: [[sel]] } : document
      const r = await window.axe.run(context, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        resultTypes: ['violations'],
      })
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }))
    }, selector ?? null)
    for (const v of result) emit({ t: 'axe', on: label, ...v })
    tally.axe += result.length
    emit({ t: 'axe-summary', on: label, violations: result.length, serious: result.filter((v) => v.impact === 'serious' || v.impact === 'critical').length })
    return result
  },

  /**
   * The HTTP requests the app's main process has started since launch (or since `since`, a count
   * from a previous call): [{ t, method, url }]. Test-only: see request-log.cjs.
   */
  requests(since = 0) {
    const lines = readFileSync(REQUEST_LOG, 'utf8').split(/\r?\n/).filter(Boolean)
    return lines.slice(since).map((l) => JSON.parse(l))
  },

  /** Reads the server (what was really saved): api('GET', '/tasks/12'). Returns parsed JSON. */
  api: (method, path, body) => serverApi.call(method, path, body),

  /** Samples requestAnimationFrame intervals for `ms` milliseconds. */
  async frames(ms = 1000, { page: p = page } = {}) {
    const deltas = await p.evaluate(
      (span) =>
        new Promise((resolve) => {
          const out = []
          let last = performance.now()
          const end = last + span
          const tick = (t) => {
            out.push(t - last)
            last = t
            if (t < end) requestAnimationFrame(tick)
            else resolve(out)
          }
          requestAnimationFrame(tick)
        }),
      ms,
    )
    const d = deltas.slice(1).sort((a, b) => a - b)
    const mean = d.reduce((s, x) => s + x, 0) / Math.max(d.length, 1)
    return {
      frames: d.length,
      meanMs: +mean.toFixed(2),
      p95Ms: +(d[Math.floor(d.length * 0.95)] ?? 0).toFixed(2),
      maxMs: +(d[d.length - 1] ?? 0).toFixed(2),
      over20ms: d.filter((x) => x > 20).length,
    }
  },

  // Quick Entry and Quick View open through the app's own second-instance path (the same code a
  // global hotkey runs), so position, focus and the shown event are the real ones.
  async showQuick(which) {
    const flag = which === 'entry' ? '--quick-entry' : '--quick-view'
    const match = which === 'entry' ? 'quick-entry' : 'quick-view'
    const win = await waitForWindow((u) => u.includes(match), 15000)
    if (!win) throw new Error(`The ${which} window does not exist (is it enabled in the profile?).`)
    await applyMedia(win)
    await app.evaluate(({ app: a }, argv) => a.emit('second-instance', {}, argv, process.cwd()), ['electron', flag])
    const end = Date.now() + 8000
    while (Date.now() < end) {
      const visible = await app.evaluate(({ BrowserWindow }, m) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes(m) && w.isVisible()), match)
      if (visible) break
      await sleep(100)
    }
    return win
  },
  async hideQuick(which) {
    const match = which === 'entry' ? 'quick-entry' : 'quick-view'
    await app.evaluate(({ BrowserWindow }, m) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().includes(m)) w.hide()
    }, match)
    await sleep(200)
  },
}

// --- Run -----------------------------------------------------------------------------------

emit({
  t: 'run',
  run: runName,
  theme: opt.theme,
  size: opt.size,
  motion: state.motion,
  forcedColors: state.forcedColors,
  scenarios: selected.map((s) => s.name),
})

// A scenario starts from Today, with nothing open.
async function reset() {
  await h.dismiss()
  await h.goto('/today').catch(() => {})
}

currentScenario = '_env'
await settle(page, 1200)
const env = await page.evaluate(() => ({
  dpr: window.devicePixelRatio,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  forcedColors: matchMedia('(forced-colors: active)').matches,
  dark: document.documentElement.classList.contains('dark'),
  width: window.innerWidth,
  height: window.innerHeight,
}))
emit({ t: 'env', ...env })
await h.assert('device scale factor is 1', env.dpr === 1)
await h.assert(`prefers-reduced-motion is ${state.motion === 'reduce' ? 'reduce' : 'no-preference'}`, env.reducedMotion === (state.motion === 'reduce'))
await h.assert(`theme is ${opt.theme}`, env.dark === (opt.theme === 'dark'))
await h.assert(`window content is ${SIZE.width}x${SIZE.height}`, { ok: env.width === SIZE.width && env.height === SIZE.height, detail: `${env.width}x${env.height}` })

for (const s of selected) {
  currentScenario = s.name
  emit({ t: 'start', title: s.meta.title })
  try {
    await reset()
    await s.run(Object.assign(Object.create(h), { wave: WAVE }))
  } catch (e) {
    tally.errors++
    emit({ t: 'error', message: String(e.message ?? e).split('\n')[0] })
  }
  // Back to the starting size, motion and colours for the next scenario.
  await h.setMotion(opt.motion).catch(() => {})
  await h.setForcedColors(opt['forced-colors']).catch(() => {})
  await h.resize(SIZE.width, SIZE.height).catch(() => {})
}

currentScenario = '-'
emit({ t: 'summary', ok: tally.errors === 0 && tally.fail === 0, run: runName, captures: tally.captures, pass: tally.pass, fail: tally.fail, errors: tally.errors, axeViolations: tally.axe, folder: RUN_DIR })

await shutdown()
process.exit(tally.errors > 0 || tally.fail > 0 ? 1 : 0)
