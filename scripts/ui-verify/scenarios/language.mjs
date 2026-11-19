// language: the Language setting (Settings, General) and the translation framework behind it
// (src/shared/i18n, locales/, docs/translating.md).
//
//   A. The harness profile is English: the sidebar's lists have their English names, <html lang="en">.
//   B. Settings offers "System default (...)" and every catalog in locales/ under its own name.
//   C. Choosing Nederlands saves `language: "nl"` and shows at once, without a restart: the
//      sidebar's lists, the setting's own label, <html lang>, and the application menu in main.
//   D. Text that is not in the catalog yet still shows, in English (the fallback).
//   E. A plural from the catalog: completing a task shows the Dutch toast.
//   F. Back to English, everything reads English again.
import { checkboxOf, makeTasks, openToday, removeTasks } from './_completion.mjs'

export const meta = {
  id: 'language',
  wave: null,
  title: 'Language: the setting switches the windows, the menus and the toasts at once, and back',
}

const sidebarLists = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('aside nav button[aria-current], aside nav:first-of-type button')]
      .map((b) => (b.textContent ?? '').replace(/\d+$/, '').trim()))

const navLabel = (page) => page.evaluate(() => document.querySelector('aside nav')?.getAttribute('aria-label') ?? '')
const htmlLang = (page) => page.evaluate(() => `${document.documentElement.lang}|${document.documentElement.dir}`)
const savedLanguage = (page) => page.evaluate(async () => (await window.api.getConfig())?.language ?? null)
const menuLabels = (app) =>
  app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label))

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await page.evaluate(() => window.api.saveConfigPatch({ language: 'en' }))
  await h.goto('/today')
  await h.wait(800)

  // ---- A. English --------------------------------------------------------------------------------
  const english = await sidebarLists(page)
  await h.assert('in English the sidebar lists Inbox, Today, Upcoming, Anytime and Logbook', {
    ok: ['Inbox', 'Today', 'Upcoming', 'Anytime', 'Logbook'].every((n) => english.includes(n)),
    detail: JSON.stringify(english),
  })
  await h.assert('the page says it is English, left to right', async () => {
    const lang = await htmlLang(page)
    return { ok: lang === 'en|ltr', detail: lang }
  })
  const englishMenu = await menuLabels(h.app)
  await h.assert('the application menu is English', { ok: englishMenu.includes('File') && englishMenu.includes('View'), detail: JSON.stringify(englishMenu) })

  // ---- B. The setting ---------------------------------------------------------------------------
  await h.goto('/settings')
  await h.wait(600)
  // Settings opens on the tab that was open last (another scenario may have left one open).
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
  await h.wait(500)
  const row = page.locator('label', { hasText: /^Language/ })
  await row.scrollIntoViewIfNeeded()
  const select = row.locator('select')
  const options = await select.locator('option').allInnerTexts()
  await h.assert('the setting offers System default and each language under its own name', {
    ok: /^System default \(.+\)$/.test(options[0]) && options.includes('English') && options.includes('Nederlands'),
    detail: JSON.stringify(options),
  })
  await h.capture('setting-english', { clip: row.locator('xpath=..') })

  // ---- C. Dutch, at once ------------------------------------------------------------------------
  await select.selectOption('nl')
  await h.wait(700)
  await h.assert('the choice is saved as language: "nl"', async () => {
    const saved = await savedLanguage(page)
    return { ok: saved === 'nl', detail: String(saved) }
  })
  const dutch = await sidebarLists(page)
  await h.assert('the sidebar lists are Dutch without a restart', {
    ok: ['Vandaag', 'Binnenkort', 'Wanneer dan ook', 'Logboek'].every((n) => dutch.includes(n)) && !dutch.includes('Today'),
    detail: JSON.stringify(dutch),
  })
  await h.assert('the list of lists is named in Dutch for a screen reader', async () => {
    const label = await navLabel(page)
    return { ok: label === 'Lijsten', detail: label }
  })
  await h.assert('the page says it is Dutch', async () => {
    const lang = await htmlLang(page)
    return { ok: lang === 'nl|ltr', detail: lang }
  })
  const dutchRow = page.locator('label', { hasText: /^Taal/ })
  await h.assert('the setting names itself in Dutch, with a link to the translating guide', async () => {
    const label = await dutchRow.count()
    const link = await page.locator('a', { hasText: 'Help Vicu vertalen' }).getAttribute('href').catch(() => null)
    return { ok: label === 1 && /docs\/translating\.md$/.test(link ?? ''), detail: `${label} ${link}` }
  })
  const dutchMenu = await menuLabels(h.app)
  await h.assert('the application menu in the main process is Dutch', {
    ok: dutchMenu.includes('Bestand') && dutchMenu.includes('Weergave') && !dutchMenu.includes('File'),
    detail: JSON.stringify(dutchMenu),
  })
  await h.capture('setting-dutch', { clip: dutchRow.locator('xpath=..') })
  await h.capture('sidebar-dutch', { clip: page.locator('aside').first() })

  // ---- D. What is not translated yet stays, in English ------------------------------------------
  // The Today view's own heading is not in the catalog yet. (When it moves, pick another text.)
  await h.goto('/today')
  await h.wait(600)
  await h.assert('text outside the catalog still shows in English', async () => {
    const heading = ((await page.locator('main h1').first().textContent().catch(() => '')) ?? '').trim()
    return { ok: heading === 'Today', detail: heading }
  })

  // ---- E. A plural, from outside React ----------------------------------------------------------
  const [taskId] = await makeTasks(h, ['Language scenario task'])
  try {
    const listed = await openToday(h, [taskId])
    await h.assert('the throwaway task is listed on Today', { ok: listed })
    await checkboxOf(h, taskId).click()
    // The toast comes when the completed row leaves its list, 5 s after the pointer left it.
    await page.mouse.move(640, 700)
    const toast = page.locator('[data-toast-kind]', { hasText: 'Voltooid' }).first()
    await h.assert('completing a task shows the Dutch toast with its Dutch Undo', async () => {
      await toast.waitFor({ timeout: 12000 }).catch(() => {})
      const text = (await toast.innerText().catch(() => '')).replace(/\s+/g, ' ')
      return { ok: text.includes('Voltooid') && text.includes('Ongedaan maken'), detail: text }
    })
    await h.capture('toast-dutch')
  } finally {
    await removeTasks(h, [taskId])
  }

  // ---- F. Back to English -----------------------------------------------------------------------
  await page.evaluate(() => window.api.saveConfigPatch({ language: 'en' }))
  await h.wait(700)
  const back = await sidebarLists(page)
  await h.assert('back in English the sidebar reads as before', { ok: JSON.stringify(back) === JSON.stringify(english), detail: JSON.stringify(back) })
  const backMenu = await menuLabels(h.app)
  await h.assert('and so does the application menu', { ok: JSON.stringify(backMenu) === JSON.stringify(englishMenu), detail: JSON.stringify(backMenu) })
}
