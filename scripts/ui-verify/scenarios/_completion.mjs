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

/**
 * Starts checking, every 16 ms in the page, that the rows of `ids` can be hit: the element under the
 * centre of each one that is on screen is the row or inside it. `stopHitWatch` returns { ticks,
 * blocked } (a row that sits under a closing row, a transition or a list-wide pointer-events: none
 * counts as blocked). Nothing may wait for an animation to finish before it takes input.
 */
export async function startHitWatch(h, ids) {
  await h.page.evaluate((taskIds) => {
    const state = { ticks: 0, blocked: [] }
    window.__hitWatch = state
    state.timer = setInterval(() => {
      for (const id of taskIds) {
        const row = document.querySelector(`[data-task-id="${id}"]`)
        if (!row || row.hasAttribute('data-row-closing')) continue
        const r = row.getBoundingClientRect()
        if (r.height < 4 || r.top < 0 || r.bottom > innerHeight) continue
        state.ticks++
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!hit || !row.contains(hit)) state.blocked.push({ id, hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 30)}` : null })
      }
    }, 16)
  }, ids)
}

export async function stopHitWatch(h) {
  return h.page.evaluate(() => {
    const state = window.__hitWatch
    clearInterval(state.timer)
    return { ticks: state.ticks, blocked: state.blocked.slice(0, 3) }
  })
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

/**
 * Starts recording, in the page, the CSS animations that start (name, duration, easing) and the
 * animations on the row of one task (the Web Animations of its close: the properties they change and
 * their duration), sampled every 16 ms. `readAnimations` returns what was seen.
 */
export async function recordAnimations(h, taskId) {
  await h.page.evaluate((id) => {
    window.__anims = []
    window.__rowAnims = []
    document.addEventListener(
      'animationstart',
      (e) => {
        const a = e.target.getAnimations?.().find((x) => x.animationName === e.animationName)
        const timing = a?.effect?.getTiming()
        window.__anims.push({ name: e.animationName, duration: timing ? Number(timing.duration) : null, easing: a?.effect?.getKeyframes()?.[0]?.easing ?? timing?.easing ?? '' })
      },
      true
    )
    window.__rowTimer = setInterval(() => {
      const row = document.querySelector(`[data-task-id="${id}"]`)
      if (!row) return
      for (const a of row.getAnimations()) {
        const effect = a.effect
        if (!effect || a.animationName || a.transitionProperty) continue
        const props = new Set()
        for (const k of effect.getKeyframes()) for (const key of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) props.add(key)
        window.__rowAnims.push({ props: [...props].sort(), duration: Number(effect.getTiming().duration) })
      }
    }, 16)
  }, taskId)
}

export async function readAnimations(h) {
  return h.page.evaluate(() => {
    clearInterval(window.__rowTimer)
    const rowAnims = []
    for (const a of window.__rowAnims ?? []) if (!rowAnims.some((x) => x.props.join() === a.props.join() && x.duration === a.duration)) rowAnims.push(a)
    return { anims: window.__anims ?? [], rowAnims }
  })
}

/** The text of the screen-reader announcement ("Completed Buy milk"), or ''. */
export const announcement = (h) => h.page.evaluate(() => document.querySelector('[data-announcer]')?.textContent?.trim() ?? '')
