// Planner duration: collapsed rows show only the hidden-metadata duration, and editing it never
// reads or rewrites start_date/end_date. The flights seed deliberately has all three values.
export const meta = {
  id: 'PD',
  wave: 4,
  title: 'Planner rows show only duration; the property preserves start/end dates',
}

const trailing = (row) => row.evaluate((element) => {
  const slot = element.lastElementChild
  return {
    text: slot?.textContent?.trim() ?? '',
    icons: slot?.querySelectorAll('svg').length ?? 0,
    label: slot?.querySelector('[aria-label^="Duration:"]')?.getAttribute('aria-label') ?? null,
  }
})

export default async function run(h) {
  const page = h.page
  await h.goto('/today')
  await h.assert('A: a duration-bearing task remains visible in Today', await page.locator('[data-task-id]').filter({ hasText: 'Book flights to Lisbon' }).count() === 1)
  await h.goto('/planner')
  // Due-only tasks now live in Unplanned; flights has an explicit start and remains in Today.
  await page.getByRole('switch', { name: 'Show unplanned tasks' }).click()

  const flights = page.locator('[data-task-id]').filter({ hasText: 'Book flights to Lisbon' }).first()
  const roadmap = page.locator('[data-task-id]').filter({ hasText: 'Draft Q4 roadmap' }).first()
  const passport = page.locator('[data-task-id]').filter({ hasText: 'Renew passport' }).first()
  const flightsId = Number(await flights.getAttribute('data-task-id'))

  await h.assert('A: a scheduled task shows its metadata duration, not its native start/end interval', {
    ok: JSON.stringify(await trailing(flights)) === JSON.stringify({ text: '45m', icons: 0, label: 'Duration: 45 minutes' }),
    detail: JSON.stringify(await trailing(flights)),
  })
  await h.assert('A: duration can coexist with notes on another Planner row', (await trailing(roadmap)).text === '90m')
  await h.assert('A: a task without duration has an empty trailing cluster', {
    ok: JSON.stringify(await trailing(passport)) === JSON.stringify({ text: '', icons: 0, label: null }),
    detail: JSON.stringify(await trailing(passport)),
  })
  await h.capture('planner-duration-rows')

  const before = await h.api('GET', `/tasks/${flightsId}`)
  await flights.click({ position: { x: 180, y: 12 } })
  const durationButton = page.locator(`[data-task-id="${flightsId}"] button[data-prop="duration"]`)
  await durationButton.click()
  await page.getByLabel('Duration in minutes').fill('60')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await h.wait(600)

  const after = await h.api('GET', `/tasks/${flightsId}`)
  await h.assert('B: the property updates only description duration and preserves start/end/due', {
    ok: after.description.includes('<!-- vicu-duration:v1:60 -->')
      && after.start_date === before.start_date
      && after.end_date === before.end_date
      && after.due_date === before.due_date,
    detail: JSON.stringify({ start: [before.start_date, after.start_date], end: [before.end_date, after.end_date], due: [before.due_date, after.due_date], description: after.description }),
  })
  await h.assert('B: the open card shows the new duration property', (await durationButton.getAttribute('aria-label')) === 'Duration: 60m')
  await h.assert('B: the calendar updates from the same optimistic task data',
    await page.locator(`[data-calendar-task="${flightsId}"]`).evaluate((element) => element.style.height === '72px'))
}
