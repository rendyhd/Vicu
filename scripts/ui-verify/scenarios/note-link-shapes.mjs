// note-link-shapes: which note link a task row offers, in the running app (description format,
// "Task links"). Anyone who may edit a task can write its notelink marker, and an obsidian: address
// can run commands, so only the two shapes Vicu writes get the Obsidian button.
//
// shell.openExternal is replaced in the main process by a recorder, so nothing is ever opened.
//
//   A. A task with obsidian://open (vault, file) and one with obsidian://advanced-uri (vault, uid)
//      show the button; a task whose marker holds a command address shows none.
//   B. A click on the button hands exactly the stored address to the system.
//   C. The main process refuses a command address even when a page asks for it directly, and
//      still opens a web address.

export const meta = {
  id: 'NLS',
  wave: 3,
  title: 'Note links: only the two shapes Vicu writes are offered and opened',
}

const pair = (url, name) => {
  const escaped = url.replace(/&/g, '&amp;')
  return `<p>Body</p><!-- notelink:${escaped} --><p><a href="${escaped}">\u{1F4CE} ${name}</a></p>`
}

const OPEN = 'obsidian://open?vault=Personal&file=Tasks%2FRunbook'
const UID = 'obsidian://advanced-uri?vault=Personal&uid=7f3c2a10-0b1e'
const COMMAND = 'obsidian://advanced-uri?vault=Personal&commandid=shell-commands%3Arun'
const WRITE = 'obsidian://advanced-uri?vault=Personal&uid=42&filepath=a.md&data=x&mode=overwrite'

export default async function run(h) {
  const { page } = h
  await h.resize(1280, 820)

  await h.app.evaluate(({ shell }) => {
    globalThis.__nlsOpened = []
    globalThis.__nlsOriginalOpen = globalThis.__nlsOriginalOpen ?? shell.openExternal
    shell.openExternal = async (url) => {
      globalThis.__nlsOpened.push(url)
    }
  })
  const opened = () => h.app.evaluate(() => [...globalThis.__nlsOpened])

  const made = []
  const make = async (title, url) => {
    const task = await h.api('POST', `/projects/${h.ids.inbox}/tasks`, { title, description: pair(url, 'Meeting notes') })
    made.push(task.id)
    return task
  }

  try {
    const open = await make('Note link scratch: open', OPEN)
    const uid = await make('Note link scratch: uid', UID)
    const command = await make('Note link scratch: command', COMMAND)
    const write = await make('Note link scratch: write', WRITE)

    await h.goto('/inbox')
    await h.key('F5') // the tasks were made behind the app's back
    await h.wait(1200)

    const button = (task) => page.locator(`[data-task-id="${task.id}"] button[title*="in Obsidian"]`)
    const row = (task) => page.locator(`[data-task-id="${task.id}"]`)

    // ---- A. Which rows offer the button --------------------------------------------------------
    await h.assert('all four tasks are listed', {
      ok: (await row(open).count()) > 0 && (await row(uid).count()) > 0 && (await row(command).count()) > 0 && (await row(write).count()) > 0,
    })
    await h.assert('obsidian://open with vault and file shows the button', { ok: (await button(open).count()) === 1 })
    await h.assert('obsidian://advanced-uri with vault and uid shows the button', { ok: (await button(uid).count()) === 1 })
    await h.assert('a command address shows no button', { ok: (await button(command).count()) === 0 })
    await h.assert('a uid with a file write shows no button', { ok: (await button(write).count()) === 0 })
    await h.capture('rows')

    // ---- B. A click opens exactly the stored address ------------------------------------------
    await button(open).first().click()
    await h.wait(300)
    await button(uid).first().click()
    await h.wait(300)
    let calls = await opened()
    await h.assert('a click hands the stored address to the system', {
      ok: calls.length === 2 && calls[0] === OPEN && calls[1] === UID,
      detail: JSON.stringify(calls),
    })

    // ---- C. Main decides again -----------------------------------------------------------------
    await page.evaluate(async ([a, b]) => {
      await window.api.openDeepLink(a)
      await window.api.openDeepLink(b)
      await window.api.openDeepLink('obsidian://new?vault=Personal&file=x&content=y&overwrite=true')
    }, [COMMAND, WRITE])
    await h.wait(200)
    calls = await opened()
    await h.assert('main refuses an Obsidian address that does more than open a note', {
      ok: calls.length === 2,
      detail: JSON.stringify(calls),
    })
    await page.evaluate(() => window.api.openDeepLink('https://example.com/page'))
    await h.wait(200)
    calls = await opened()
    await h.assert('main still opens a web address', {
      ok: calls.length === 3 && calls[2] === 'https://example.com/page',
      detail: JSON.stringify(calls),
    })

    // The refused marker is still in the task, untouched.
    const stored = await h.api('GET', `/tasks/${command.id}`)
    await h.assert('a refused marker stays in the description', {
      ok: (stored.description ?? '').includes('notelink:obsidian://advanced-uri?vault=Personal&amp;commandid='),
      detail: stored.description,
    })
  } finally {
    for (const id of made) await h.api('DELETE', `/tasks/${id}`).catch(() => {})
    await h.app.evaluate(({ shell }) => {
      if (globalThis.__nlsOriginalOpen) shell.openExternal = globalThis.__nlsOriginalOpen
    }).catch(() => {})
  }
}
