// Helpers for the completion scenarios (E1, E2, E11): throwaway tasks due today, row and checkbox
// locators, and timing read inside the page so the 5 s hold is measured without harness latency.
import { dateOnly } from '../lib.mjs'

export const HOLD_MS = 5000
export const TOAST_MS = 6000

/** Creates tasks in the Inbox, due today (date only), and returns their ids. They are deleted afterwards. */
export async function makeTasks(h, titles) {
  const ids = []
  for (const title of titles) {
    const made = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title, due_date: dateOnly(0) })
    ids.push(made.id)
  }
  return ids
}

export async function removeTasks(h, ids) {
  for (const id of ids) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
}

export const rowOf = (h, id) => h.page.locator(`[data-task-id="${id}"]`)
export const checkboxOf = (h, id) => rowOf(h, id).locator('button[role="checkbox"]').first()

/** Opens Today and waits until every task is listed. */
export async function openToday(h, ids) {
  // The tasks were made on the server behind the app's back: a visit elsewhere makes Today refetch.
  await h.goto('/anytime')
  await h.goto('/today')
  const end = Date.now() + 15000
  while (Date.now() < end) {
    let all = true
    for (const id of ids) if ((await rowOf(h, id).count()) === 0) all = false
    if (all) return true
    await h.wait(200)
  }
  return false
}

/** performance.now() of the page. */
export const pageNow = (h) => h.page.evaluate(() => performance.now())

/** Page time at which the row left the DOM, or null when it was still there after `timeoutMs`. */
export function rowGoneAt(h, id, timeoutMs) {
  return h.page.evaluate(
    ([taskId, timeout]) =>
      new Promise((resolve) => {
        const start = performance.now()
        const timer = setInterval(() => {
          if (!document.querySelector(`[data-task-id="${taskId}"]`)) {
            clearInterval(timer)
            resolve(performance.now())
          } else if (performance.now() - start > timeout) {
            clearInterval(timer)
            resolve(null)
          }
        }, 20)
      }),
    [id, timeoutMs]
  )
}

/** Moves the real pointer to the view heading, away from every row. Returns the page time. */
export async function pointerAway(h) {
  const box = await h.page.locator('h1').first().boundingBox()
  await h.page.mouse.move(box ? box.x + 4 : 300, box ? box.y + 4 : 20, { steps: 4 })
  return pageNow(h)
}

/** The completed state the server holds for a task. */
export async function serverDone(h, id) {
  const task = await h.api('GET', `/tasks/${id}`)
  return task.done === true
}

/** The success toast ("Completed", "n completed") in the live region. */
export const toastRegion = (h) => h.page.locator('[aria-live="polite"] [data-toast-kind="success"]').first()

/** The message of the success toast, or null when none is showing (a toast that is fading out counts as gone). */
export function toastText(h) {
  return h.page.evaluate(() => {
    const el = document.querySelector('[aria-live="polite"] [data-toast-kind="success"]:not(.vicu-toast-out)')
    return el ? el.querySelector('span.flex-1')?.textContent ?? '' : null
  })
}
