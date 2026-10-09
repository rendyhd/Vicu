// Card 2.8: one place to add a task. A quiet "New task" row ends each list and turns into the composer
// in place; the header "+" opens the composer at the top; the dashed pills are gone.
export const meta = {
  id: 'NT',
  wave: 2,
  title: 'The New task row ends each list; the composer opens at the end and, from the header +, at the top',
}

const composerBox = (page) => page.getByPlaceholder('New task').first().boundingBox()

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)

  for (const [name, route] of [['today', '/today'], ['inbox', '/inbox'], ['area', `/project/${h.ids.work}`]]) {
    await h.goto(route)
    await h.dismiss()
    const buttons = page.locator('button[aria-label="New task"]')
    const row = buttons.last()
    const lastRowBox = await h.lastRow().boundingBox().catch(() => null)
    const rowBox = await row.boundingBox()
    await h.assert(`${name}: a New task row is on the page`, { ok: !!rowBox, detail: rowBox && Math.round(rowBox.y) })
    if (name !== 'area' && lastRowBox && rowBox) {
      await h.assert(`${name}: the row comes after the last task`, { ok: rowBox.y > lastRowBox.y, detail: `${Math.round(lastRowBox.y)} < ${Math.round(rowBox.y)}` })
    }
    const dashed = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => getComputedStyle(b).borderStyle.includes('dashed')).length)
    await h.assert(`${name}: no dashed pill buttons`, { ok: dashed === 0, detail: dashed })
    await h.capture(`${name}-list`)

    if (name === 'area') {
      // Between sections a strip shows "Add section" on hover only.
      const strip = page.locator('button[aria-label="Add section"]').first()
      const opacity = () => strip.evaluate((el) => Number(getComputedStyle(el).opacity))
      await h.assert('area: the Add section strip is hidden until hovered', { ok: (await opacity()) === 0 })
      await strip.scrollIntoViewIfNeeded()
      await strip.hover()
      await h.wait(300)
      await h.assert('area: the strip shows on hover', { ok: (await opacity()) === 1 })
      await h.capture('area-add-section-hover')
    }

    if (name === 'inbox') {
      // At the end: the row turns into the composer in the same place.
      await row.click()
      await h.wait(300)
      const end = await composerBox(page)
      await h.assert('inbox: the composer opens where the row was', { ok: !!end && Math.abs(end.y - rowBox.y) < 80, detail: end && `${Math.round(end.y)} vs ${Math.round(rowBox.y)}` })
      await h.assert('inbox: the row is gone while the composer is open', { ok: (await buttons.count()) === 1 })
      await h.capture('inbox-composer-end')
      await h.key('Escape')
      await h.wait(250)

      // At the top: the header + opens it above the first task.
      await buttons.first().click()
      await h.wait(300)
      const top = await composerBox(page)
      const firstBox = await h.rows().first().boundingBox()
      await h.assert('inbox: the header + opens the composer above the first task', { ok: !!top && !!firstBox && top.y < firstBox.y, detail: top && firstBox && `${Math.round(top.y)} < ${Math.round(firstBox.y)}` })
      await h.capture('inbox-composer-top')
      await h.key('Escape')
      await h.wait(250)
    }
  }
}
