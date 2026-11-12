// CALA: Microsoft 365 and Google calendar accounts (plan phase 2e, contract 20.9), against the local
// fake provider (scripts/ui-verify/fake-calendar-oauth.mjs). The app is pointed at it with
// VICU_TEST_CALENDAR_ENDPOINTS (read only by an unpackaged build), and shell.openExternal is
// replaced in the main process by a stand-in browser that follows the authorization redirect back
// to Vicu's loopback listener. Real input in the add dialog throughout.
//
//   A. Microsoft without a registered client: the dialog says so; a wrong client id is said plainly;
//      a right one is saved ("Use my own client").
//   B. Sign in: the waiting state, then the pick of calendars (paged), Add.
//   C. Plan, tomorrow: busy, free and tentative events drawn; cancelled and declined ones not.
//   D. Google with an official client (the override pretends one): Sign in at once, own client
//      under Advanced; a calendar hidden in Google starts unticked; its events drawn.
//   E. A work account that needs admin consent: the organisation sentence and the page for IT.
//   F. A refresh token the provider no longer takes: "Sign in again" on the account, which works.
//   G. No token, secret or client in clear on disk; removing Google revokes its token.
//
// Its own throwaway data only (titles "CALA ..."): every connection and own client is removed.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { startFakeCalendarProvider } from '../fake-calendar-oauth.mjs'

export const meta = {
  id: 'CALA',
  wave: 6,
  title: 'Calendar accounts: Microsoft 365 and Google (fake provider)',
}

const MS_CLIENT = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const fake = await startFakeCalendarProvider({ prefix: 'CALA ' })
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'))
  const setOverride = (value) => h.app.evaluate((_electron, json) => {
    if (json) process.env.VICU_TEST_CALENDAR_ENDPOINTS = json
    else delete process.env.VICU_TEST_CALENDAR_ENDPOINTS
  }, value ? JSON.stringify(value) : null)
  // The stand-in browser: waits `delay` ms, then follows the redirect to the loopback listener.
  await h.app.evaluate(({ shell }) => {
    globalThis.__calaOpened = []
    globalThis.__calaBrowserDelay = 0
    globalThis.__calaOriginalOpen = globalThis.__calaOriginalOpen ?? shell.openExternal
    shell.openExternal = async (url) => {
      globalThis.__calaOpened.push(url)
      setTimeout(async () => {
        try {
          const first = await fetch(url, { redirect: 'manual' })
          const location = first.headers.get('location')
          if (location) await fetch(location.replace('://localhost:', '://127.0.0.1:'))
        } catch {
          // The sign-in then times out or is cancelled.
        }
      }, globalThis.__calaBrowserDelay)
    }
  })
  const setBrowserDelay = (ms) => h.app.evaluate((_electron, value) => { globalThis.__calaBrowserDelay = value }, ms)

  const eventTitles = () => page.locator('[data-plan-event]').evaluateAll((nodes) => nodes.map((n) => ({ text: n.textContent, title: n.getAttribute('title'), top: parseFloat(n.style.top) })))
  const openTomorrow = async () => {
    await h.goto('/plan')
    await page.locator('[data-plan-view="day"]').click()
    await page.locator('[data-plan-today]').click()
    await page.locator('[data-plan-next]').click()
    await h.wait(1500)
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-plan-scroller]')
      if (scroller) scroller.scrollTop = 8 * 60 - 20
    })
    await h.wait(400)
  }
  const openCalendarsSettings = async () => {
    await h.goto('/settings?section=calendars')
    await page.locator('[data-calendar-feeds]').waitFor({ timeout: 10000 })
    await page.locator('[data-calendar-feeds]').scrollIntoViewIfNeeded()
    await h.wait(300)
  }
  const openAdd = async (kind) => {
    await page.locator('[data-calendar-open-add]').click()
    await page.locator('[data-calendar-dialog]').waitFor()
    await page.locator(`[data-calendar-choice="kind:${kind}"]`).click()
    await page.locator(`[data-calendar-oauth="${kind}"]`).waitFor({ timeout: 5000 })
    await h.wait(200)
  }

  try {
    await setOverride({ microsoft: fake.endpoints.microsoft, google: fake.endpoints.google })
    await page.evaluate(() => window.api.saveConfigPatch({ planner_enabled: true, planner_view: 'day', planner_source: 'day' }))
    await page.reload()
    await h.wait(1200)

    // --- A. Microsoft without a registered client ----------------------------------------------
    await openCalendarsSettings()
    await openAdd('microsoft')
    await h.assert('A: the dialog says there is no registered Microsoft client', await page.locator('[data-calendar-no-client]').isVisible())
    await h.assert('A: Sign in waits for a client', await page.locator('[data-calendar-oauth-sign-in]').isDisabled())
    await h.capture('dialog-ms-no-client')
    await h.axe('[data-calendar-dialog]', { label: 'microsoft without a client' })
    await page.locator('[data-calendar-client-id]').click()
    await h.type('my-app')
    await page.locator('[data-calendar-client-save]').click()
    const wrongId = await page.locator('[data-calendar-client-error]').innerText()
    await h.assert('A: a client id that is not one is said plainly', /Application \(client\) ID/.test(wrongId), wrongId)
    await page.locator('[data-calendar-client-id]').fill('')
    await page.locator('[data-calendar-client-id]').click()
    await h.type(MS_CLIENT, { delay: 2 })
    await page.locator('[data-calendar-client-save]').click()
    await page.locator('[data-calendar-advanced]').waitFor({ timeout: 5000 })
    await h.assert('A: with an own client, Sign in is offered', await page.locator('[data-calendar-oauth-sign-in]').isEnabled())
    await page.locator('[data-calendar-advanced]').click()
    const shownId = await page.locator('[data-calendar-own-client-id]').innerText()
    await h.assert('A: the own client is named (its id, never a secret)', shownId === MS_CLIENT, shownId)
    await h.capture('dialog-ms-own-client')
    await page.locator('[data-calendar-advanced]').click()

    // --- B. Sign in ------------------------------------------------------------------------------
    await setBrowserDelay(1500)
    await page.locator('[data-calendar-oauth-sign-in]').click()
    await page.locator('[data-calendar-waiting]').waitFor({ timeout: 5000 })
    await h.capture('dialog-ms-waiting')
    await page.locator('[data-calendar-found]').waitFor({ timeout: 15000 })
    await setBrowserDelay(0)
    const opened = await h.app.evaluate(() => globalThis.__calaOpened.at(-1))
    const authUrl = new URL(opened)
    await h.assert('B: the browser was sent to the authorization page with PKCE', authUrl.searchParams.get('code_challenge_method') === 'S256' && Boolean(authUrl.searchParams.get('code_challenge')))
    await h.assert('B: the redirect is http://localhost on a free port', /^http:\/\/localhost:\d+\/$/.test(authUrl.searchParams.get('redirect_uri') ?? ''), authUrl.searchParams.get('redirect_uri'))
    await h.assert('B: the read-only scope only', authUrl.searchParams.get('scope') === 'Calendars.ReadBasic offline_access openid profile')
    const found = await page.locator('[data-calendar-found] li').allInnerTexts()
    await h.assert('B: every page of calendars is offered, the default first', JSON.stringify(found) === JSON.stringify(['CALA Calendar', 'CALA Work', 'CALA Holidays']), found)
    const signedIn = await page.locator('[data-calendar-signed-in]').innerText()
    await h.assert('B: it says which account signed in', signedIn.startsWith('sam@contoso.example'), signedIn)
    await page.locator('[data-calendar-found-item="CALA Holidays"]').click()
    await h.capture('dialog-ms-pick')
    await h.axe('[data-calendar-dialog]', { label: 'microsoft pick' })
    await page.locator('[data-calendar-account-save]').click()
    await page.locator('[data-calendar-dialog]').waitFor({ state: 'detached', timeout: 15000 })
    const msBlock = page.locator('[data-calendar-connection]', { hasText: 'Microsoft 365' })
    await h.assert('B: the account is listed with its calendars', (await msBlock.locator('[data-calendar-feed]').count()) === 3)

    // --- C. Plan, tomorrow ------------------------------------------------------------------------
    await openTomorrow()
    let events = await eventTitles()
    const has = (text) => events.find((e) => e.text.includes(text))
    await h.assert('C: busy, free and tentative events are drawn', ['CALA Design review', 'CALA Lunch (free)', 'CALA Maybe sync', 'CALA Retro', 'CALA Plumber'].every((t) => has(t)), events.map((e) => e.text))
    await h.assert('C: a cancelled and a declined event are not drawn', !has('CALA Cancelled call') && !has('CALA Declined meeting'))
    await h.assert('C: the review is at 10:00 local time', has('CALA Design review')?.top === 600, has('CALA Design review'))
    await h.assert('C: the tentative event says so', /Tentative/.test(has('CALA Maybe sync')?.title ?? ''), has('CALA Maybe sync')?.title)
    await h.assert('C: the unshown calendar is not read', !events.some((e) => e.text.includes('CALA Public holiday')))
    await h.capture('plan-microsoft')

    // --- D. Google with an official client --------------------------------------------------------
    await setOverride({ microsoft: fake.endpoints.microsoft, google: fake.endpoints.google, clients: { google: { clientId: 'cala-official.apps.googleusercontent.com', clientSecret: fake.state.googleSecret } } })
    await openCalendarsSettings()
    await openAdd('google')
    await page.locator('[data-calendar-advanced]').waitFor({ timeout: 5000 }).catch(() => {})
    await h.capture('dialog-google-official')
    await h.assert('D: with an official client, Sign in is offered at once', await page.locator('[data-calendar-oauth-sign-in]').isEnabled() && !(await page.locator('[data-calendar-no-client]').count()))
    await page.locator('[data-calendar-advanced]').click()
    await page.locator('[data-calendar-client-secret]').waitFor()
    await h.capture('dialog-google-advanced')
    await h.axe('[data-calendar-dialog]', { label: 'google with advanced' })
    await page.locator('[data-calendar-advanced]').click()
    await page.locator('[data-calendar-oauth-sign-in]').click()
    await page.locator('[data-calendar-found]').waitFor({ timeout: 15000 })
    const ticks = await page.locator('[data-calendar-found] input[type="checkbox"]').evaluateAll((nodes) => nodes.map((n) => [n.getAttribute('data-calendar-found-item'), n.checked]))
    await h.assert('D: a calendar hidden in Google starts unticked', JSON.stringify(ticks) === JSON.stringify([['Calendar', true], ['CALA Family', true], ['CALA Holidays', false]]), ticks)
    await h.capture('dialog-google-pick')
    await page.locator('[data-calendar-account-save]').click()
    await page.locator('[data-calendar-dialog]').waitFor({ state: 'detached', timeout: 15000 })
    await openTomorrow()
    events = await eventTitles()
    await h.assert('D: the Google events are drawn', ['CALA Dentist', 'CALA Focus (free)', 'CALA Team lunch', 'CALA School play'].every((t) => has(t)), events.map((e) => e.text))
    await h.assert('D: declined, cancelled and working-location entries are not', !has('CALA Declined planning') && !has('CALA Cancelled sync') && !events.some((e) => e.text === 'Home'))
    await h.capture('plan-google')

    // --- E. Admin consent needed ------------------------------------------------------------------
    await openCalendarsSettings()
    await openAdd('microsoft')
    fake.state.authorizeError = { error: 'consent_required', description: 'AADSTS65001: The user or administrator has not consented to use the application.' }
    await page.locator('[data-calendar-oauth-sign-in]').click()
    await page.locator('[data-calendar-org-approval]').waitFor({ timeout: 15000 })
    const orgText = await page.locator('[data-calendar-org-approval]').innerText()
    await h.assert('E: the organisation sentence, never the provider\'s description', orgText.includes('Your organisation needs to approve Vicu') && !orgText.includes('AADSTS'), orgText)
    const itLink = await page.locator('[data-calendar-link="it-admins"]').getAttribute('href')
    await h.assert('E: a link to the page for IT', /calendar-it-admins\.md$/.test(itLink ?? ''), itLink)
    await h.capture('dialog-ms-org-approval')
    await h.axe('[data-calendar-dialog]', { label: 'org approval' })
    await page.keyboard.press('Escape')
    await page.locator('[data-calendar-dialog]').waitFor({ state: 'detached', timeout: 5000 })
    await h.assert('E: Escape closes the dialog and stays in Settings', (await page.locator('[data-calendar-feeds]').count()) === 1)

    // --- F. Sign in again -------------------------------------------------------------------------
    fake.state.refreshError = { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired due to inactivity.' }
    fake.expireAccessTokens()
    await page.locator('[data-calendar-refresh]').click()
    // Both accounts' tokens stopped working; Microsoft is signed in again here, Google is removed below.
    const repair = page.locator('[data-calendar-connection]', { hasText: 'Microsoft 365' }).locator('[data-calendar-sign-in-again]')
    await repair.waitFor({ timeout: 15000 })
    const msBlockText = await page.locator('[data-calendar-connection]', { hasText: 'Microsoft 365' }).innerText()
    await h.assert('F: the account says to sign in again, once', (msBlockText.match(/Sign in again: Microsoft no longer accepts/g) ?? []).length === 1, msBlockText)
    const msStatus = await page.locator('[data-calendar-connection]', { hasText: 'Microsoft 365' }).locator('[data-calendar-status]').first().innerText()
    await h.assert('F: its calendars say since when', /^Not updated since /.test(msStatus), msStatus)
    await h.capture('settings-sign-in-again')
    await h.axe('[data-calendar-feeds]', { label: 'calendars with accounts' })
    fake.state.refreshError = null
    await repair.click()
    await repair.waitFor({ state: 'detached', timeout: 15000 })
    const after = await page.evaluate(() => window.api.calendar.list())
    const ms = after.connections.find((c) => c.kind === 'microsoft')
    await h.assert('F: after signing in again the account reads without an error', ms && ms.calendars.filter((c) => c.enabled).every((c) => !c.error) && !ms.error, ms)
    await h.capture('settings-accounts')

    // --- G. Nothing secret on disk; removing Google revokes ----------------------------------------
    const store = readFileSync(join(userData, 'calendar-feeds.json'), 'utf8')
    await h.assert('G: calendar-feeds.json holds no token, secret or account address', !/\b(rt|at)-\d+-/.test(store) && !store.includes(fake.state.googleSecret) && !store.includes('sam@') && !store.includes(fake.origin))
    const clientsFile = join(userData, 'calendar-oauth-clients.json')
    await h.assert('G: the own client is kept encrypted', existsSync(clientsFile) && !readFileSync(clientsFile, 'utf8').includes(MS_CLIENT))
    const google = after.connections.find((c) => c.kind === 'google')
    await page.evaluate((id) => window.api.calendar.remove(id), google.id)
    await h.assert('G: removing the Google account revoked its token', fake.state.revoked.length === 1, fake.state.revoked.length)
  } finally {
    await page.evaluate(async () => {
      const view = await window.api.calendar.list()
      for (const connection of view.connections) await window.api.calendar.remove(connection.id)
      await window.api.calendar.oauthSetClient('microsoft', null)
      await window.api.calendar.oauthSetClient('google', null)
      await window.api.saveConfigPatch({ planner_enabled: false, planner_view: 'day', planner_source: 'day' })
    }).catch(() => {})
    await setOverride(null).catch(() => {})
    await h.app.evaluate(({ shell }) => {
      if (globalThis.__calaOriginalOpen) shell.openExternal = globalThis.__calaOriginalOpen
    }).catch(() => {})
    await fake.close()
  }
}
