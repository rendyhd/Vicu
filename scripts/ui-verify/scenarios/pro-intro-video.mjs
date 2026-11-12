// PROV: the "Getting started with Vicu Pro" video. Not a test: run it on its own with --video,
//
//   npm run ui:verify -- --scenario pro-intro-video --video --size 1280x800 --run pro-video
//
// then cut and convert the recording with the times it writes to <run>/video-times.json
// (ffmpeg: start at "start", stop at "end"). A calm walk through the four parts of Pro, one chapter
// each: turning it on, Available and the reasons, flags and quick add; a person, a promise, its
// verdict, Waiting on and the person page; an initiative, readiness, the capped portfolio, parking
// and a request's triage; a Quick wins list, the table, the inspector and the weekly review. Captions and a visible pointer are drawn
// in the page (in the top layer, so popovers do not cover them). Its own throwaway project, label
// and tasks; everything is deleted and Pro is turned off at the end.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const meta = {
  id: 'PROV',
  wave: 99,
  title: 'Video: getting started with Vicu Pro',
}

const PROJECT = 'Team offsite'
const PERSON = 'Maya'
const EXTRAS = [
  ['Website relaunch', ['Write the launch post', 'Check the redirects']],
  ['Hiring plan', ['Draft the job post']],
  ['Customer survey', ['Pick ten customers']],
]
const REQUEST = 'Sam asks for a team photo booth'

const pad = (n) => String(n).padStart(2, '0')
const dayFrom = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const midnightOf = (day) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0).toISOString()
}

/** Caption, pointer and title card, drawn as manual popovers so they stay above the app's own. */
function installOverlay() {
  if (document.getElementById('vv-cap')) return
  const style = document.createElement('style')
  style.textContent = `
    .vv { margin: 0; border: 0; padding: 0; background: transparent; overflow: visible; inset: auto; pointer-events: none; }
    #vv-cap { position: fixed; left: 50%; bottom: 26px; translate: -50% 0; max-width: 900px; width: max-content;
      padding: 13px 22px; border-radius: 14px; background: rgba(22, 24, 30, 0.9); color: #fff;
      font: 500 20px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; text-align: center;
      box-shadow: 0 10px 34px rgba(0, 0, 0, 0.28); opacity: 0; transition: opacity 0.35s; }
    #vv-cap.on { opacity: 1; }
    #vv-cap b { color: #9fd0ff; font-weight: 600; }
    #vv-cur { position: fixed; left: 0; top: 0; width: 26px; height: 26px; translate: -13px -13px;
      border-radius: 50%; background: rgba(10, 102, 209, 0.18); border: 2.5px solid rgba(10, 102, 209, 0.95);
      transition: scale 0.12s, background 0.12s; }
    #vv-cur.down { scale: 0.72; background: rgba(10, 102, 209, 0.45); }
    #vv-title { position: fixed; inset: 0; width: 100vw; height: 100vh; display: grid; place-content: center;
      text-align: center; background: #fbfbfd; color: #1d1d1f; opacity: 0; transition: opacity 0.6s;
      font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif; }
    #vv-title.on { opacity: 1; }
    #vv-title h1 { font-size: 46px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 14px; }
    #vv-title p { font-size: 22px; color: #555; margin: 0; line-height: 1.5; }
    #vv-title .mark { font-size: 15px; font-weight: 650; letter-spacing: 0.14em; text-transform: uppercase; color: #0a66d1; margin-bottom: 18px; }
  `
  document.head.appendChild(style)
  const make = (id, tag = 'div') => {
    const el = document.createElement(tag)
    el.id = id
    el.className = 'vv'
    el.setAttribute('popover', 'manual')
    document.body.appendChild(el)
    el.showPopover()
    return el
  }
  // The local build's version number would date the video; the alpha has its own.
  for (const el of document.querySelectorAll('aside *')) {
    if (el.children.length === 0 && /^v\d+\.\d+\.\d+/.test(el.textContent?.trim() ?? '')) el.style.visibility = 'hidden'
  }
  make('vv-title')
  make('vv-cap')
  const cur = make('vv-cur')
  document.addEventListener('mousemove', (e) => {
    cur.style.left = `${e.clientX}px`
    cur.style.top = `${e.clientY}px`
  }, true)
  document.addEventListener('mousedown', () => cur.classList.add('down'), true)
  document.addEventListener('mouseup', () => cur.classList.remove('down'), true)
  // Keep ours on top: when the app opens a popover or dialog, show ours again after it.
  let last = ''
  setInterval(() => {
    const open = [...document.querySelectorAll(':popover-open, dialog[open]')].filter((el) => !el.classList.contains('vv'))
    const key = open.map((el) => el.tagName + (el.id || el.className)).join('|')
    if (key === last) return
    last = key
    for (const id of ['vv-title', 'vv-cap', 'vv-cur']) {
      const el = document.getElementById(id)
      if (!el) continue
      try {
        el.hidePopover()
        el.showPopover()
      } catch {}
    }
  }, 120)
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 800)
  await h.dismiss()

  // --- Throwaway data -----------------------------------------------------------------------------
  const projects = await h.api('GET', '/projects?per_page=200')
  for (const stale of Array.isArray(projects) ? projects : projects.items ?? []) {
    if (stale.title === PROJECT || EXTRAS.some(([t]) => t === stale.title)) await h.api('DELETE', `/projects/${stale.id}`).catch(() => {})
  }
  const labels = await h.api('GET', '/labels?per_page=200')
  for (const stale of Array.isArray(labels) ? labels : labels.items ?? []) {
    if (stale.title === PERSON) await h.api('DELETE', `/labels/${stale.id}`).catch(() => {})
  }
  const promiseTitles = ['Send the venue options', 'Share the budget']
  const findTasks = async (title) => {
    const found = await h.api('GET', `/tasks?q=${encodeURIComponent(title)}&per_page=50`).catch(() => [])
    return (Array.isArray(found) ? found : found.items ?? []).filter((t) => t.title === title)
  }
  for (const title of [...promiseTitles, REQUEST]) for (const t of await findTasks(title)) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
  for (const list of (await page.evaluate(() => window.api.getCustomLists()).catch(() => [])) ?? []) {
    if (list?.name === 'Quick wins') await page.evaluate((id) => window.api.deleteCustomList(id), list.id).catch(() => {})
  }
  const mutate = (operations) => page.evaluate((ops) => window.api.mutateProLedger(ops), operations)
  const extras = []

  let project = null
  let label = null
  const times = {}
  try {
    project = await h.api('PUT', '/projects', { title: PROJECT }).catch(() => h.api('POST', '/projects', { title: PROJECT }))
    const make = (title, fields = {}) => h.api('POST', `/projects/${project.id}/tasks`, { title, ...fields })
    const pick = await make('Pick a date with the team', { due_date: midnightOf(dayFrom(2)) })
    const venue = await make('Book the venue')
    const invites = await make('Send the invitations')
    await make('Order lunch', { start_date: midnightOf(dayFrom(4)) })
    const wishes = await make('Collect dietary wishes')
    const estimated = []
    for (const [extraTitle, extraTasks] of EXTRAS) {
      const extra = await h.api('PUT', '/projects', { title: extraTitle }).catch(() => h.api('POST', '/projects', { title: extraTitle }))
      extras.push(extra)
      for (const t of extraTasks) estimated.push(await h.api('POST', `/projects/${extra.id}/tasks`, { title: t }))
    }
    await h.api('PUT', `/tasks/${invites.id}/relations`, { other_task_id: venue.id, relation_kind: 'blocked' })
      .catch(() => h.api('POST', `/tasks/${invites.id}/relations`, { other_task_id: venue.id, relation_kind: 'blocked' }))
    label = await h.api('PUT', '/labels', { title: PERSON, hex_color: '8e5cd9' }).catch(() => h.api('POST', '/labels', { title: PERSON, hex_color: '8e5cd9' }))

    await page.evaluate(() => window.api.saveConfigPatch({
      pro_enabled: false, pro_list_views: {}, pro_focus: null, pro_onboarding_seen: true, pro_layers: {},
    }))
    await page.evaluate((id) => window.api.setSyncedPreferences({ [`task_order.project.${id}`]: 'oldest' }), project.id)
    await page.reload()
    await h.wait(1800)
    await h.goto('/today')
    await page.keyboard.press('F5')
    await h.wait(1500)
    await page.evaluate(installOverlay)
    await page.mouse.move(640, 420)
    await h.wait(400)

    // --- Helpers ------------------------------------------------------------------------------------
    const say = async (html, ms = 3200) => {
      if (html) h.emit({ t: 'say', at: h.videoTime(), text: html })
      await page.evaluate((x) => {
        const cap = document.getElementById('vv-cap')
        cap.innerHTML = x
        cap.classList.toggle('on', !!x)
      }, html)
      if (ms) await h.wait(ms)
    }
    const title = async (heading, text, ms, mark = 'Vicu Pro') => {
      await page.evaluate(({ a, b, m }) => {
        const el = document.getElementById('vv-title')
        el.innerHTML = a ? `<div class="mark">${m}</div><h1>${a}</h1><p>${b}</p>` : ''
        el.classList.toggle('on', !!a)
        document.getElementById('vv-cur').style.opacity = a ? '0' : '1'
      }, { a: heading, b: text, m: mark })
      await h.wait(ms)
    }
    const glide = async (locator, { click = true, steps = 28, button = 'left', dx, dy } = {}) => {
      await locator.scrollIntoViewIfNeeded().catch(() => {})
      const box = await locator.boundingBox()
      if (!box) throw new Error('glide: no box')
      const x = box.x + (dx ?? box.width / 2)
      const y = box.y + (dy ?? box.height / 2)
      await page.mouse.move(x, y, { steps })
      await h.wait(260)
      if (click) {
        await page.mouse.down({ button })
        await h.wait(110)
        await page.mouse.up({ button })
      }
    }
    const typeSlow = (text) => page.keyboard.type(text, { delay: 75 })
    const proNav = () => page.locator('nav[aria-label="Pro"]')
    const rowOf = (id) => page.locator(`[data-task-id="${id}"]`).first()
    const sidebar = page.locator('aside[aria-label="Sidebar"]')

    // --- 0. Title -----------------------------------------------------------------------------------
    await title('Getting started', 'One switch, four parts.<br>Start with one. Add more when you need it.', 0)
    times.start = h.videoTime()
    await h.wait(4200)
    await title('', '', 700)

    // --- 1. Turn it on ------------------------------------------------------------------------------
    await say('Pro is off until you turn it on. Open <b>Settings</b>.', 2600)
    await glide(sidebar.getByRole('button', { name: 'Settings', exact: true }))
    await h.wait(900)
    await glide(page.getByRole('button', { name: 'Pro', exact: true }))
    await h.wait(700)
    await say('Turn on <b>Pro on this device</b>. It only adds: turn it off later and nothing is removed.', 1800)
    await glide(page.getByRole('switch', { name: /Turn on Pro/ }))
    await h.wait(2600)
    await say('It comes in four parts, and each works on its own.', 2200)
    await page.mouse.move(700, 470, { steps: 25 })
    await say('Start with the first: <b>Know what you can do now</b>.', 3600)

    // --- 2. Available -------------------------------------------------------------------------------
    await say('', 200)
    await title('Know what you can do now', 'See what you can act on today,<br>and why the rest has to wait.', 0, 'Part 1 of 4')
    await h.wait(3600)
    await title('', '', 700)
    await say('Open a project. It now shows what you can do <b>right now</b>.', 1600)
    await glide(sidebar.getByText(PROJECT, { exact: true }).first())
    await h.wait(1600)
    await say('Two tasks are left out, because they have to wait.', 2400)
    await glide(page.locator('[data-pro-hidden-summary] button'), { click: false })
    await say('<b>Show remaining</b> tells you why.', 1400)
    await glide(page.locator('[data-pro-hidden-summary] button'))
    await h.wait(1200)
    await glide(rowOf(invites.id).locator('[data-pro-reason]'), { click: false })
    await say('<b>Send the invitations</b> comes after <b>Book the venue</b>.', 3000)
    await glide(page.locator('[data-pro-reason]', { hasText: /^Starts/ }).first(), { click: false })
    await say('<b>Order lunch</b> starts later, so it stays out of the way until then.', 3400)

    // --- 3. Finish what it waits for ---------------------------------------------------------------
    await say('Finish what a task waits for...', 1400)
    await glide(rowOf(venue.id).locator('[role="checkbox"]').first())
    await h.wait(1600)
    await page.mouse.move(900, 600, { steps: 20 })
    await say('...and the next one is ready to go.', 3600)
    await glide(page.locator('[data-pro-view="available"]'))
    await h.wait(1500)

    // --- 4. Flags -----------------------------------------------------------------------------------
    await say('Flag the few tasks that matter most.', 1600)
    await glide(rowOf(pick.id), { dx: 260 })
    await h.wait(900)
    await glide(page.locator('[data-prop="pro-flag"]'))
    await h.wait(900)
    await page.keyboard.press('Escape')
    await h.wait(500)
    await say('<b>Flagged</b> gathers them in one place.', 1200)
    await glide(proNav().getByRole('button', { name: 'Flagged' }))
    await h.wait(2800)

    // --- 5. Quick add -------------------------------------------------------------------------------
    await say('Or type it as you add a task: a start date, an estimate, a flag.', 1400)
    await glide(sidebar.getByText(PROJECT, { exact: true }).first())
    await h.wait(900)
    await page.keyboard.press('Control+n')
    await h.wait(600)
    await typeSlow('Book the bus starts friday ~30m !flag')
    await h.wait(900)
    await say('<b>starts friday</b> &middot; <b>~30m</b> &middot; <b>!flag</b>', 3200)
    await page.keyboard.press('Enter')
    await h.wait(700)
    await page.keyboard.press('Escape')
    await h.wait(500)
    await say('It starts Friday, so it waits out of sight until then.', 3000)

    // --- 6. A person --------------------------------------------------------------------------------
    await title('Promises and people', 'What people promised you,<br>and what you promised them.', 0, 'Part 2 of 4')
    await h.wait(3800)
    await title('', '', 700)
    await say('Any label can be a person. Right-click it and choose <b>This is a person</b>.', 1800)
    const personLabel = sidebar.getByText(PERSON, { exact: true }).first()
    await glide(personLabel, { button: 'right' })
    await h.wait(900)
    await glide(page.getByRole('menuitem', { name: 'This is a person' }))
    await h.wait(1800)

    // --- 7. A promise and a verdict -------------------------------------------------------------------
    await say('Type a name and a colon: it becomes <b>her promise to you</b>.', 1200)
    await glide(page.locator('nav[aria-label="Lists"]').getByText('Today', { exact: true }).first())
    await h.wait(900)
    await page.keyboard.press('Control+n')
    await h.wait(600)
    await typeSlow(`${PERSON}: Send the venue options today`)
    await h.wait(1600)
    await page.keyboard.press('Enter')
    await h.wait(600)
    await typeSlow(`${PERSON}: Share the budget friday`)
    await h.wait(700)
    await page.keyboard.press('Enter')
    await h.wait(700)
    await page.keyboard.press('Escape')
    await h.wait(400)
    await page.keyboard.press('F5')
    await h.wait(1800)
    const [options] = await findTasks('Send the venue options')
    await say('Promises due are at the top of <b>Today</b>, with her mark instead of a checkbox.', 3400)
    await say('When one is due, click the mark and say how it went.', 1200)
    await glide(page.locator(`[data-pro-promises-due] [data-task-id="${options?.id}"] [data-pro-person-mark]`).first())
    await h.wait(900)
    await say('Delivered, Late, Not yet, New date or Dropped.', 2600)
    await glide(page.locator('[data-pro-verdict="delivered"]').first())
    await h.wait(2400)

    // --- 8. Waiting on and the person page ------------------------------------------------------------
    await say('<b>Waiting on</b> lists what others still owe you.', 1200)
    await glide(proNav().getByRole('button', { name: 'Waiting on' }))
    await h.wait(3000)
    await say('Each person has a page, with an agenda for your next 1:1.', 1200)
    await glide(proNav().getByRole('button', { name: 'People' }))
    await h.wait(1200)
    await glide(page.locator('[data-pro-people] button', { hasText: PERSON }).first())
    await h.wait(1500)
    await glide(page.getByRole('button', { name: /Copy agenda/ }), { click: false })
    await say('Copy it into the meeting invite, and start from what was agreed.', 3800)

    // --- 9. Portfolio ---------------------------------------------------------------------------------
    await say('', 200)
    await title('Portfolio', 'For steering several initiatives at once,<br>and saying "not now" with reasons.', 0, 'Part 3 of 4')
    // Three initiatives already running, and a few estimates for the Quick wins list later.
    await mutate([
      ...extras.map((extra, index) => ({ op: 'set', collection: 'initiatives', id: String(extra.id), value: { status: 'active', rank: index + 1, owner: label.id } })),
      { op: 'estimate', taskId: wishes.id, minutes: 10 },
      { op: 'estimate', taskId: pick.id, minutes: 15 },
      { op: 'estimate', taskId: estimated[1].id, minutes: 15 },
      { op: 'estimate', taskId: estimated[0].id, minutes: 45 },
    ])
    await page.keyboard.press('F5')
    await h.wait(3400)
    await title('', '', 700)
    await say('Any project can be an initiative. Open its menu.', 1200)
    await glide(sidebar.getByText(PROJECT, { exact: true }).first(), { button: 'right' })
    await h.wait(800)
    await glide(page.getByRole('menuitem', { name: 'Initiative' }))
    await h.wait(700)
    await glide(page.getByRole('menuitem', { name: 'Make this an initiative' }))
    await h.wait(1200)
    await glide(sidebar.getByText(PROJECT, { exact: true }).first())
    await h.wait(1200)
    const panel = page.locator('[data-pro-initiative-panel]')
    await say('It gets a sponsor, an owner and a <b>readiness</b> check.', 1200)
    await glide(panel.locator('label', { hasText: 'Owner' }).locator('select'), { click: false })
    await panel.locator('label', { hasText: 'Owner' }).locator('select').selectOption({ label: PERSON })
    await h.wait(1200)
    await glide(panel.getByRole('button', { name: /Ready \d+\/\d+/ }))
    await h.wait(1000)
    await say('Nine questions to answer before it starts, such as why now and what done looks like.', 1000)
    await glide(panel.locator('label', { hasText: 'Why now' }).locator('input'))
    await typeSlow('The team has not met in a year')
    await h.wait(500)
    await glide(panel.locator('label', { hasText: 'Done looks like' }).locator('input'))
    await typeSlow('Everyone home with three agreed goals')
    await page.keyboard.press('Tab')
    await h.wait(1800)
    await say('<b>Portfolio</b> ranks them, with a cap on how many run at once.', 1200)
    await glide(proNav().getByRole('button', { name: 'Portfolio' }))
    await h.wait(3200)
    await say('Four is the cap. To start another, something has to give: <b>park</b> one, with a reason.', 1200)
    const survey = extras[2]
    await glide(page.locator(`[data-pro-initiative="${survey.id}"]`).getByRole('button', { name: 'Park' }))
    await h.wait(900)
    await typeSlow('After the offsite')
    await h.wait(500)
    await glide(page.getByRole('dialog').getByRole('button', { name: 'Park', exact: true }))
    await h.wait(1200)
    await say('Its tasks wait until it is active again.', 3000)

    await say('New requests go through <b>triage</b>: type <b>req:</b> in front.', 1200)
    await glide(page.locator('nav[aria-label="Lists"]').getByText('Inbox', { exact: true }).first())
    await h.wait(900)
    await page.keyboard.press('Control+n')
    await h.wait(600)
    await typeSlow(`req: ${REQUEST}`)
    await h.wait(700)
    await page.keyboard.press('Enter')
    await h.wait(1500)
    await say('Accept it into an initiative, delegate it, decline it, or ask the sponsor.', 1200)
    const triage = page.getByRole('dialog')
    await glide(triage.getByRole('radio', { name: 'Accept' }))
    const initiativeSelect = triage.getByLabel('Initiative')
    await initiativeSelect.selectOption(await initiativeSelect.locator('option', { hasText: PROJECT }).first().getAttribute('value'))
    await glide(triage.getByLabel('Initiative'), { click: false })
    await h.wait(1500)
    await glide(triage.getByRole('button', { name: 'Do it and copy the reply' }))
    await h.wait(900)
    await say('The reply for whoever asked is on your clipboard.', 2800)
    await page.keyboard.press('Escape')
    await h.wait(300)
    await say('The <b>Sponsor desk</b> gathers escalations and the decisions you are owed.', 1000)
    await glide(proNav().getByRole('button', { name: 'Sponsor desk' }))
    await h.wait(3400)

    // --- 10. Power tools -----------------------------------------------------------------------------
    await say('', 200)
    await title('Power tools', 'Faster ways through a lot of tasks,<br>and a regular look back.', 0, 'Part 4 of 4')
    await h.wait(3800)
    await title('', '', 700)
    await say('Custom lists get Pro conditions. Start from a ready-made one.', 1200)
    await glide(page.getByRole('button', { name: 'New list' }).first())
    await h.wait(1000)
    await glide(page.locator('[data-pro-list-starters]').getByRole('button', { name: 'Quick wins' }))
    await h.wait(1200)
    await say('<b>Quick wins</b>: available now, 15 minutes or less.', 2600)
    await glide(page.getByRole('button', { name: 'Create', exact: true }))
    await h.wait(1000)
    await glide(sidebar.getByText('Quick wins', { exact: true }).first())
    await h.wait(2200)
    await say('Show any list as a <b>table</b>, and sort by a column.', 1200)
    await glide(page.getByRole('radio', { name: 'Table' }))
    await h.wait(1200)
    await glide(page.locator('th button').filter({ hasText: /Estimate/ }).first())
    await h.wait(2400)
    await glide(page.getByRole('radio', { name: 'Rows' }))
    await h.wait(600)

    await say('Change many tasks at once: select them and open the <b>inspector</b> (Ctrl+I).', 1000)
    await glide(sidebar.getByText(PROJECT, { exact: true }).first())
    await h.wait(1200)
    const projectRows = page.locator('[data-task-id]')
    await page.keyboard.down('Control')
    await glide(projectRows.nth(0), { dx: 300 })
    await glide(projectRows.nth(1), { dx: 300 })
    await page.keyboard.up('Control')
    await h.wait(600)
    await page.keyboard.press('Control+i')
    await h.wait(1200)
    await glide(page.locator('[data-pro-inspector]').getByRole('button', { name: '30m' }))
    await h.wait(1600)
    await say('Start, estimate and flag, for all of them.', 2400)
    await page.keyboard.press('Escape')
    await h.wait(300)
    await page.keyboard.press('Escape')
    await h.wait(500)

    await say('The <b>weekly review</b> starts with execution: verdicts, recaps, escalations, the portfolio.', 1000)
    await glide(page.locator('nav[aria-label="Lists"]').getByText('Review', { exact: true }).first())
    await h.wait(900)
    await glide(page.getByRole('button', { name: /Weekly review/ }).first())
    await h.wait(4200)
    await say('Plan my day uses your estimates too, and keeps a focus block for your top initiatives.', 3600)

    // --- 11. The end -----------------------------------------------------------------------------------
    await say('Turn the parts on one at a time, in <b>Settings, Pro</b>.', 1000)
    await glide(sidebar.getByRole('button', { name: 'Settings', exact: true }))
    await h.wait(900)
    await glide(page.getByRole('button', { name: 'Pro', exact: true }))
    await h.wait(900)
    await page.mouse.move(700, 520, { steps: 25 })
    await h.wait(3000)
    await say('', 300)
    await title('Start small', 'Learn more in the guide:<br><b>vicutodo.app/guide/pro</b>', 0)
    await h.wait(4800)
    times.end = h.videoTime()
  } finally {
    writeFileSync(join(h.runDir, 'video-times.json'), JSON.stringify(times))
    await mutate([project, ...extras].filter(Boolean).map((x) => ({ op: 'set', collection: 'initiatives', id: String(x.id), value: null }))).catch(() => {})
    for (const list of (await page.evaluate(() => window.api.getCustomLists()).catch(() => [])) ?? []) {
      if (list?.name === 'Quick wins') await page.evaluate((id) => window.api.deleteCustomList(id), list.id).catch(() => {})
    }
    for (const extra of extras) await h.api('DELETE', `/projects/${extra.id}`).catch(() => {})
    await page.evaluate(() => { try { localStorage.removeItem('vicu-pro-list-table') } catch {} }).catch(() => {})
    for (const title of [...promiseTitles, 'Book the bus', REQUEST]) for (const t of await findTasks(title)) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
    if (project) await h.api('DELETE', `/projects/${project.id}`).catch(() => {})
    if (label) {
      await page.evaluate((id) => window.api.setSyncedPreferences({ [`label_kind.${id}`]: null }), label.id).catch(() => {})
      await h.api('DELETE', `/labels/${label.id}`).catch(() => {})
    }
    if (project) await page.evaluate((id) => window.api.setSyncedPreferences({ [`task_order.project.${id}`]: null }), project.id).catch(() => {})
    await page.evaluate(() => window.api.saveConfigPatch({ pro_enabled: false, pro_list_views: {}, pro_focus: null })).catch(() => {})
  }
}
