// A narrow window (rendyhd/Vicu#73, renderer lib/sidebar-width.ts): the sidebar button hides and
// shows the sidebar in a wide window; below 664 px the sidebar is a drawer over the content, opened
// by the button or Mod+\ and closed by a list, Escape, the scrim or the button; nothing on the main
// views sticks out of a 360 px window. Read-only, apart from the device setting sidebar_hidden,
// which it leaves as it found it (shown).
export const meta = {
  id: 'NARROW',
  wave: 6,
  title: 'Narrow window: hideable sidebar, a drawer below 664 px, views at 360 px',
}

/** Controls a person can reach that end beyond the window's right edge (outside a sideways scroller). */
async function stickingOut(page) {
  return page.evaluate(() => {
    const width = window.innerWidth
    const scrollsSideways = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth) return true
      }
      return false
    }
    const out = []
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], h1')) {
      if (!(el instanceof HTMLElement) || el.closest('[hidden], [inert], dialog:not([open])')) continue
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0 || box.right <= width + 1) continue
      if (scrollsSideways(el)) continue
      out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" right ${Math.round(box.right)}`)
    }
    return out
  })
}

export default async function narrowWindow(h) {
  const page = h.page
  const toggle = page.locator('[data-sidebar-toggle]')
  const sidebar = page.locator('#app-sidebar')
  const scrim = page.locator('[data-sidebar-scrim]')
  const placement = () => sidebar.getAttribute('data-sidebar-placement')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

  // Wide: the button hides the sidebar and shows it again.
  await h.resize(1280, 820)
  await h.goto('/inbox')
  await h.wait(400)
  await h.assert('wide: the sidebar is beside the content', (await placement()) === 'docked')
  await h.assert('wide: the button says the sidebar is shown', (await toggle.getAttribute('aria-expanded')) === 'true')
  await toggle.click()
  await h.wait(300)
  await h.assert('wide: the button hides the sidebar', (await placement()) === 'hidden' && !(await sidebar.isVisible()))
  const mainWidth = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)
  await h.assert('wide: the content takes the room', { ok: mainWidth > 1200, detail: mainWidth })
  await h.capture('wide-hidden')
  await page.keyboard.press(`${mod}+Backslash`)
  await h.wait(300)
  await h.assert('wide: Mod+\\ shows it again', (await placement()) === 'docked')
  const saved = await h.page.evaluate(() => window.api.getConfig().then((c) => c?.sidebar_hidden === true))
  await h.assert('wide: shown again is saved', !saved)

  // Between: the sidebar gives way so the content keeps 480 px.
  await h.resize(700, 700)
  await h.wait(300)
  await h.assert('700 px: the sidebar is still beside the content', (await placement()) === 'docked')
  const between = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)
  await h.assert('700 px: the content keeps at least 480 px', { ok: between >= 480, detail: between })

  // Narrow: a drawer, closed at first.
  await h.resize(600, 700)
  await h.wait(300)
  await h.assert('600 px: the sidebar is a closed drawer', (await placement()) === 'drawer-closed' && !(await sidebar.isVisible()))
  await h.assert('600 px: the button says it is hidden', (await toggle.getAttribute('aria-expanded')) === 'false')
  await h.capture('600-closed')

  await toggle.click()
  await h.wait(400)
  await h.assert('the button opens the drawer', (await placement()) === 'drawer-open' && (await sidebar.isVisible()) && (await scrim.isVisible()))
  await h.assert('focus is in the drawer', await sidebar.evaluate((el) => el.contains(document.activeElement)))
  await h.assert('the content cannot be reached', await page.evaluate(() => !!document.querySelector('main')?.closest('[inert]')))
  const drawerBox = await sidebar.boundingBox()
  await h.assert('the drawer leaves content in view', { ok: !!drawerBox && drawerBox.width <= 600 - 48, detail: drawerBox?.width })
  await h.capture('600-open')
  await h.axe('#app-sidebar')

  await sidebar.locator('button', { hasText: 'Today' }).first().click()
  await h.wait(400)
  await h.assert('a list in the drawer opens it and closes the drawer', (await page.evaluate(() => location.hash)).includes('/today') && (await placement()) === 'drawer-closed')

  await page.keyboard.press(`${mod}+Backslash`)
  await h.wait(300)
  await h.assert('Mod+\\ opens the drawer', (await placement()) === 'drawer-open')
  await page.keyboard.press('Escape')
  await h.wait(300)
  await h.assert('Escape closes it', (await placement()) === 'drawer-closed')
  await h.assert('focus goes back to the button', await toggle.evaluate((el) => el === document.activeElement))

  await toggle.click()
  await h.wait(300)
  await page.mouse.click(590, 400)
  await h.wait(300)
  await h.assert('a click beside the drawer closes it', (await placement()) === 'drawer-closed')

  // The smallest window: the main views fit.
  await h.resize(360, 700)
  await h.wait(300)
  const routes = ['/inbox', '/today', '/upcoming', '/anytime', '/logbook', '/settings']
  // A project page, opened from the drawer (the seed's "Website redesign").
  routes.push('project')
  for (const route of routes) {
    if (route === 'project') {
      // On Settings the drawer holds the Settings menu: open it from a list.
      await h.goto('/inbox')
      await toggle.click()
      await h.wait(400)
      await sidebar.getByText('Website redesign', { exact: true }).first().click()
    } else {
      await h.goto(route)
    }
    await h.wait(600)
    const out = await stickingOut(page)
    const name = route.replace(/\//g, '-').replace(/^-/, '') || 'root'
    await h.assert(`360 px ${route}: nothing sticks out`, { ok: out.length === 0, detail: out.slice(0, 6).join('; ') })
    await h.capture(`360-${name}`)
  }

  // Settings puts its menu in the drawer.
  await h.goto('/settings')
  await toggle.click()
  await h.wait(400)
  await h.assert('360 px Settings: its menu is in the drawer', await sidebar.getByRole('navigation', { name: 'Settings' }).isVisible())
  await h.capture('360-settings-drawer')
  await sidebar.getByRole('button', { name: 'Notifications', exact: true }).click()
  await h.wait(400)
  await h.assert('a Settings tab closes the drawer', (await placement()) === 'drawer-closed' && (await page.locator('main h1').textContent())?.trim() === 'Notifications')

  // A task card at 360 px.
  await h.goto('/inbox')
  await h.wait(500)
  const first = page.locator('[data-task-id]').first()
  if (await first.count()) {
    await first.dblclick().catch(() => {})
    await h.wait(600)
    const out = await stickingOut(page)
    await h.assert('360 px open card: nothing sticks out', { ok: out.length === 0, detail: out.slice(0, 6).join('; ') })
    await h.capture('360-card')
    // The comments pane lies over the content instead of squeezing it.
    await page.keyboard.press(`${mod}+Shift+C`)
    await h.wait(500)
    const pane = page.locator('#comments-pane')
    if (await pane.count()) {
      const box = await pane.boundingBox()
      await h.assert('360 px comments: the pane lies within the window', { ok: !!box && box.x >= 0 && box.x + box.width <= 361, detail: box && `${Math.round(box.x)}+${Math.round(box.width)}` })
      await h.capture('360-comments')
      await page.keyboard.press(`${mod}+Shift+C`)
      await h.wait(300)
    } else {
      h.skip('360 px comments', 'the pane did not open')
    }
    await h.dismiss()
  }

  // Wide again: beside the content, as before.
  await h.resize(1280, 820)
  await h.wait(300)
  await h.assert('wide again: the sidebar is beside the content', (await placement()) === 'docked')
  // Settings opens on General again for the scenarios after this one.
  await h.goto('/settings')
  await h.wait(400)
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name: 'General', exact: true }).click()
  await h.goto('/inbox')
}
