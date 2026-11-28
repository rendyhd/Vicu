// The Settings menu (lib/settings-menu.ts): a column beside the settings in a wide window, the app
// sidebar's place in a narrow one (with Back to app), the open tab's sections listed under it and
// followed while scrolling. Read-only: only tabs are opened and the page scrolled.
export const meta = {
  id: 'SETM',
  wave: 6,
  title: 'Settings menu: column when wide, in the sidebar when narrow, sections followed',
}

export default async function settingsMenu(h) {
  const page = h.page
  const menu = page.getByRole('navigation', { name: 'Settings' })
  const appSidebarLists = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('search')

  await h.resize(1280, 820)
  await h.goto('/settings')
  await h.wait(500)
  await h.assert('wide: the menu is drawn', await menu.isVisible())
  await h.assert('wide: the app sidebar stays', await appSidebarLists.isVisible())
  await h.assert('wide: no Back to app', (await page.getByRole('button', { name: 'Back to app' }).count()) === 0)
  await h.assert('the page is titled by the open tab', (await page.locator('main h1').textContent())?.trim() === 'General')
  const sections = page.getByRole('list', { name: 'General sections' }).getByRole('button')
  const count = await sections.count()
  await h.assert('General lists its sections', { ok: count >= 3, detail: count })
  await h.capture('wide-general')

  // A section link scrolls to it and marks it.
  const last = sections.nth(count - 1)
  await last.click()
  await h.wait(400)
  await h.assert('the clicked section is marked', (await last.getAttribute('aria-current')) === 'location')
  await h.capture('wide-general-last-section')

  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await h.wait(400)
  await h.assert('another tab: its title', (await page.locator('main h1').textContent())?.trim() === 'Notifications')
  await h.capture('wide-notifications')

  await h.resize(900, 600)
  await h.wait(300)
  await h.assert('narrow: Back to app is shown', await page.getByRole('button', { name: 'Back to app' }).isVisible())
  await h.assert('narrow: the app sidebar lists are gone', (await appSidebarLists.count()) === 0)
  await h.assert('narrow: one menu', (await menu.count()) === 1)
  await h.assert('narrow: the tab is kept', (await page.locator('main h1').textContent())?.trim() === 'Notifications')
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main')
    return main ? main.scrollWidth - main.clientWidth : -1
  })
  await h.assert('narrow: nothing overflows sideways', { ok: overflow === 0, detail: overflow })
  await h.capture('narrow-notifications')

  await page.getByRole('button', { name: 'Back to app' }).click()
  await h.wait(500)
  await h.assert('Back to app leaves Settings', !(await page.evaluate(() => location.hash)).startsWith('#/settings'))
  await h.assert('the app sidebar is back', await appSidebarLists.isVisible())
  await h.resize(1280, 820)
}
