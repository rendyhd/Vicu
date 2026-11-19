import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BASELINE_FILE, compareBaseline, hardcodedIn, readBaseline, scanHardcoded } from '../../../../scripts/i18n.mjs'

// Text a person reads belongs in locales/en.json and reaches the screen through `t`
// (CLAUDE.md "Translations"). Most of the app was written before that, so the baseline records
// how many hardcoded texts each file still has; a file may only go down.

describe('hardcoded text', () => {
  it('does not grow: new text goes into locales/en.json', async () => {
    const { grown } = compareBaseline(await scanHardcoded(), readBaseline())
    const report = grown.map((g) =>
      `${g.file}: ${g.now} hardcoded texts, the baseline allows ${g.before}. Put the new text in locales/en.json and show it with t(). Its texts:\n` +
      g.found.map((f) => `    line ${f.line}: ${f.text}`).join('\n'))
    expect(report, 'see CLAUDE.md "Translations"; `node scripts/i18n.mjs hardcoded <file>` lists a file').toEqual([])
  })

  it('keeps what was gained: the baseline is current', async () => {
    const { shrunk } = compareBaseline(await scanHardcoded(), readBaseline())
    const report = shrunk.map((s) => `${s.file}: ${s.now} hardcoded texts, the baseline still says ${s.before}`)
    expect(report, `run \`npm run i18n:baseline\` and commit ${BASELINE_FILE}`).toEqual([])
  })
})

describe('hardcodedIn', () => {
  const find = (code: string, file = 'x.tsx') => hardcodedIn(ts, file, code).map((f) => f.text)

  it('finds JSX text, text attributes and text in JSX expressions', () => {
    expect(find('const a = <p>Week starts on</p>')).toEqual(['Week starts on'])
    expect(find('const a = <input placeholder="New task" aria-label="Title" className="mb-2 block" />')).toEqual(['New task', 'Title'])
    expect(find("const a = <p>{open ? 'Hide details' : 'Show details'}</p>")).toEqual(['Hide details', 'Show details'])
    expect(find('const a = <p title={`Due ${date}`}>{count}</p>')).toEqual(['Due'])
  })

  it('finds text properties and text calls', () => {
    expect(find("const o = [{ value: 'tray', label: 'Hide to system tray' }]", 'x.ts')).toEqual(['Hide to system tray'])
    expect(find("dialog.showMessageBox({ message: 'Delete this task?', buttons: ['Delete', 'Cancel'] })", 'x.ts')).toEqual(['Delete this task?', 'Delete', 'Cancel'])
    expect(find("toast.error('Could not save the task')", 'x.ts')).toEqual(['Could not save the task'])
    expect(find('announce(`Moved ${title} up`)', 'x.ts')).toEqual(['Moved up'])
  })

  it('leaves translated text, ids, symbols and comparisons alone', () => {
    expect(find("const a = <p aria-label={t('nav.lists')}>{t('nav.inbox')}</p>")).toEqual([])
    expect(find("const o = { label: t('menu.file'), title: 'nav.inbox', name: 'week_start' }", 'x.ts')).toEqual([])
    expect(find("const a = <p>{kind === 'done' ? <Check /> : '–'} · 3</p>")).toEqual([])
    expect(find('const a = <kbd>K</kbd>')).toEqual([])
  })

  it('skips a line marked i18n-ignore, on it or above it', () => {
    expect(find('const a = <p>Vicu</p> // i18n-ignore: the name')).toEqual([])
    expect(find('// i18n-ignore: a format example\nconst a = <p>yyyy-mm-dd</p>')).toEqual([])
    expect(find('const a = <p>Vicu</p>\nconst b = <p>Tasks</p>')).toEqual(['Vicu', 'Tasks'])
  })
})
