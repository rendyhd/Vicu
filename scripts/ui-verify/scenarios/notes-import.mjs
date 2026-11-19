// NOTE (docs/ai-assistant-v1.md section 4.9): making tasks from notes in the real app, with a fake
// OpenAI-compatible model on a local port.
//
//   A. Test connection asks whether the model reads pictures (the vision probe).
//   B. A PDF and a picture dropped on the window open the notes with two pages: the PDF's text read
//      by pdf.js in the built app (its worker under the app's CSP), the picture waiting to be read.
//   C. Read sends the picture as an image and puts the answer in the page.
//   D. Organize sends the pages as <notes>; the plan opens in the review sheet with an owner chip
//      and a tick per card; a name nobody has is not ticked until "Everything".
//   E. Add creates the ticked tasks only, with the source line in their notes and a named title.
//
// Its own throwaway tasks with the prefix NOTE; everything is deleted at the end.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

export const meta = {
  id: 'NOTE',
  wave: 6,
  title: 'Notes to tasks: vision probe, PDF and picture pages, read, organize, review, add',
}

/** A one-page PDF whose text layer holds the lines. */
function pdfWith(lines) {
  const stream = ['BT', '/F1 14 Tf', '72 720 Td', '18 TL', ...lines.map((line) => `(${line.replace(/[()\\]/g, '\\$&')}) '`), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1').toString('base64')
}

export default async function run(h) {
  const page = h.page
  await h.resize(1400, 900)
  await h.dismiss()

  const fixture = JSON.parse(readFileSync(new URL('../../../test-fixtures/ai-tools-v1.json', import.meta.url), 'utf8'))
  const picture = fixture.probe.vision.image.data

  const leftBehind = await h.api('GET', `/tasks?q=${encodeURIComponent('NOTE ')}&per_page=200`)
  for (const stale of Array.isArray(leftBehind) ? leftBehind : leftBehind.items ?? []) {
    if (/^(NOTE |Lalith: NOTE )/.test(String(stale.title))) await h.api('DELETE', `/tasks/${stale.id}`).catch(() => {})
  }

  const requests = { read: [], notes: [], probe: 0 }
  const sse = (content) => [
    { choices: [{ delta: { content } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  const task = (ref, title, owner, from, page = 1) => ({
    ref, title, notes: '', when: { said: null, date: null, time: null }, project_id: null, project_ref: null,
    owner, page, from, labels: [], priority: null, repeat: null, reminder: null, place: null, subtasks: [], unsure: [],
  })
  const model = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fake' }] }))
        return
      }
      const request = JSON.parse(body || '{}')
      const send = (content) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(sse(content))
      }
      if (Array.isArray(request.tools) && request.tools.length > 0) {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add_numbers', arguments: '{"a":2,"b":3}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n')
        return
      }
      const user = request.messages?.find((m) => m.role === 'user')?.content
      if (Array.isArray(user)) {
        const text = user.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
        const images = user.filter((part) => part.type === 'image_url').length
        if (text.includes(fixture.probe.vision.user)) {
          requests.probe += 1
          send(JSON.stringify({ word: 'LAMP', number: 47 }))
          return
        }
        requests.read.push({ text, images })
        send('NOTE call the caterer\nLalith: NOTE send the budget')
        return
      }
      const said = String(user ?? '')
      if (said.includes('<notes>')) {
        requests.notes.push(said)
        send(JSON.stringify({
          projects: [],
          tasks: [
            task('d1', 'NOTE book the venue', 'me', 'NOTE book the venue for March'),
            task('d2', 'NOTE send the budget', 'Lalith', 'Lalith: NOTE send the budget', 2),
          ],
          decisions: [{ what: 'NOTE offsite in March', by: null, page: 1 }],
          questions: [],
          unclear: [],
        }))
        return
      }
      send(JSON.stringify({ answer: 5 }))
    })
  })
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${model.address().port}/v1`
  const before = new Set()
  const inboxTasks = async () => {
    const list = await h.api('GET', `/projects/${h.ids.inbox}/tasks?per_page=200`).catch(() => [])
    return Array.isArray(list) ? list : list.items ?? []
  }
  for (const t of await inboxTasks()) before.add(t.id)

  try {
    // --- A. The vision probe --------------------------------------------------------------------
    const tested = await page.evaluate(async (addr) => {
      await window.api.ai.saveSettings({ provider: 'ollama', address: addr, models: { dictation: 'fake', ask: 'fake' }, features: { dictation: true } })
      return window.api.ai.testConnection('fake')
    }, address)
    await h.assert('A: Test connection asks whether the model reads pictures', () => ({
      ok: tested.success && tested.data.vision?.ok === true && requests.probe === 1,
      detail: JSON.stringify(tested).slice(0, 200),
    }))
    // The window reads the assistant's settings once: load it again to see them.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await h.wait(2500)

    // --- B. Dropping a PDF and a picture ----------------------------------------------------------
    const pdf = pdfWith(['Offsite NOTE', 'NOTE book the venue for March'])
    await page.evaluate(async ({ pdf, picture }) => {
      const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bytes(pdf)], 'offsite.pdf', { type: 'application/pdf' }))
      dt.items.add(new File([bytes(picture)], 'whiteboard.png', { type: 'image/png' }))
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, cancelable: true }))
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }))
    }, { pdf, picture })
    const dialog = page.locator('[data-notes-dialog]')
    await dialog.waitFor({ timeout: 10000 })
    await page.locator('[data-notes-page]').nth(1).waitFor({ timeout: 15000 })
    const pages = await page.locator('[data-notes-page]').evaluateAll((rows) => rows.map((row) => ({
      status: row.getAttribute('data-status'),
      text: row.querySelector('textarea')?.value ?? '',
    })))
    await h.assert('B: two pages, one per file', pages.length === 2, JSON.stringify(pages))
    await h.assert('B: pdf.js read the PDF\'s text in the built app', () => ({ ok: pages[0]?.status === 'ready' && pages[0].text.includes('NOTE book the venue'), detail: JSON.stringify(pages[0]) }))
    await h.assert('B: the picture waits to be read', pages[1]?.status === 'unread', JSON.stringify(pages[1]))
    await h.capture('pages')

    // --- C. Reading the picture -------------------------------------------------------------------
    await dialog.getByRole('button', { name: /^Read 1 picture$/ }).click()
    await page.locator('[data-notes-page][data-status="ready"]').nth(1).waitFor({ timeout: 15000 })
    const read = requests.read[0]
    await h.assert('C: the picture went out as one image with the page\'s number', () => ({ ok: !!read && read.images === 1 && read.text.includes('2'), detail: JSON.stringify(read ?? null).slice(0, 200) }))
    const readText = await page.locator('[data-notes-page]').nth(1).locator('textarea').inputValue()
    await h.assert('C: the answer is the page\'s text', readText.includes('Lalith: NOTE send the budget'), readText)

    // --- D. Organize and review -------------------------------------------------------------------
    await dialog.getByRole('button', { name: /^Organize$/ }).click()
    const sheet = page.locator('[data-dictation-panel]')
    await sheet.locator('[data-notes-plan-bar]').waitFor({ timeout: 15000 })
    const sent = requests.notes[0] ?? ''
    await h.assert('D: both pages went out as <notes>', ['<page n="1">', '<page n="2">', 'NOTE book the venue', 'NOTE send the budget'].every((part) => sent.includes(part)), sent.slice(0, 300))
    const cards = sheet.locator('[data-notes-card]')
    await h.assert('D: one card per task with its owner chip', (await cards.count()) === 2, await cards.count())
    const ticks = await sheet.locator('[data-draft-ref]').evaluateAll((articles) => articles.map((a) => ({ title: a.querySelector('input')?.value, dimmed: a.hasAttribute('data-dimmed') })))
    await h.assert('D: the default filter ticks yours and leaves a name it does not know out', JSON.stringify(ticks.map((c) => c.dimmed)) === '[false,true]', JSON.stringify(ticks))
    await sheet.locator('[data-notes-plan-bar] select').selectOption('mine')
    await h.wait(200)
    const mineOnly = await sheet.locator('[data-draft-ref]').evaluateAll((articles) => articles.map((a) => a.hasAttribute('data-dimmed')))
    await h.assert('D: "Mine only" leaves Lalith\'s task out', JSON.stringify(mineOnly) === '[false,true]', JSON.stringify(mineOnly))
    await sheet.locator('[data-notes-plan-bar] select').selectOption('everything')
    await h.wait(200)
    await h.assert('D: the decision is listed', (await sheet.getByText('NOTE offsite in March').count()) === 1)
    await h.capture('review')

    // --- E. Add ----------------------------------------------------------------------------------
    await sheet.getByRole('button', { name: /^Add 2 tasks$/ }).click()
    await sheet.waitFor({ state: 'detached', timeout: 15000 })
    let added = []
    for (let i = 0; i < 20 && added.length < 2; i++) {
      await h.wait(500)
      added = (await inboxTasks()).filter((t) => !before.has(t.id))
    }
    const titles = added.map((t) => t.title).sort()
    await h.assert('E: both ticked tasks were added, the named one with the name in its title', JSON.stringify(titles) === JSON.stringify(['Lalith: NOTE send the budget', 'NOTE book the venue']), JSON.stringify(titles))
    const venue = added.find((t) => t.title === 'NOTE book the venue')
    await h.assert('E: its notes say where it came from', () => ({ ok: !!venue && String(venue.description).includes('page 1') && String(venue.description).includes('NOTE book the venue for March'), detail: String(venue?.description ?? '').slice(0, 200) }))
    await h.assert('E: the notes window closed', (await page.locator('[data-notes-dialog]').count()) === 0)
  } finally {
    for (const t of await inboxTasks()) if (!before.has(t.id) && /NOTE /.test(String(t.title))) await h.api('DELETE', `/tasks/${t.id}`).catch(() => {})
    await page.evaluate(() => window.api.notes.clearSession()).catch(() => {})
    await page.evaluate(() => window.api.ai.saveSettings({ provider: '', features: { dictation: false } })).catch(() => {})
    await new Promise((resolve) => model.close(resolve))
  }
}
