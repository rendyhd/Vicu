import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { saveAttachment, type SaveAttachmentDeps } from '../attachment-save'

function deps(overrides: Partial<SaveAttachmentDeps> = {}): SaveAttachmentDeps {
  return {
    chooseFile: vi.fn(async (defaultPath: string) => defaultPath),
    download: vi.fn(async () => ({ success: true as const, data: Buffer.from('pdf bytes') })),
    writeFile: vi.fn(async () => undefined),
    markFile: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('saveAttachment', () => {
  it('offers the file under its own name in the start folder and writes the downloaded bytes there', async () => {
    const d = deps()

    const result = await saveAttachment('Invoice March.pdf', 7, '/Users/me/Downloads', d)

    const expected = join('/Users/me/Downloads', 'Invoice March.pdf')
    expect(d.chooseFile).toHaveBeenCalledWith(expected)
    expect(d.writeFile).toHaveBeenCalledWith(expected, Buffer.from('pdf bytes'))
    expect(result).toEqual({ success: true, data: { saved: true, path: expected } })
  })

  it('marks the saved file as downloaded from the internet, after writing it', async () => {
    const order: string[] = []
    const d = deps({
      writeFile: vi.fn(async () => { order.push('write') }),
      markFile: vi.fn(async (path: string) => { order.push(`mark ${path}`) }),
    })

    await saveAttachment('a.exe', 7, '/Users/me/Downloads', d)

    expect(order).toEqual(['write', `mark ${join('/Users/me/Downloads', 'a.exe')}`])
  })

  it('does not mark a file it could not write', async () => {
    const d = deps({ writeFile: vi.fn(async () => { throw new Error('EACCES') }) })

    await saveAttachment('a.txt', 7, '/tmp', d)

    expect(d.markFile).not.toHaveBeenCalled()
  })

  it('keeps a server-supplied name inside the folder', async () => {
    const d = deps()

    await saveAttachment('../../etc/passwd', 7, '/Users/me/Downloads', d)

    expect(d.chooseFile).toHaveBeenCalledWith(join('/Users/me/Downloads', 'passwd'))
  })

  it('downloads nothing when the user cancels', async () => {
    const d = deps({ chooseFile: vi.fn(async () => null) })

    const result = await saveAttachment('a.txt', 7, '/tmp', d)

    expect(result).toEqual({ success: true, data: { saved: false } })
    expect(d.download).not.toHaveBeenCalled()
    expect(d.writeFile).not.toHaveBeenCalled()
  })

  it('passes a failed download on and writes nothing', async () => {
    const d = deps({ download: vi.fn(async () => ({ success: false as const, error: 'Not found', statusCode: 404 })) })

    const result = await saveAttachment('a.txt', 7, '/tmp', d)

    expect(result).toEqual({ success: false, error: 'Not found', statusCode: 404 })
    expect(d.writeFile).not.toHaveBeenCalled()
  })

  it('reports a file that could not be written', async () => {
    const d = deps({ writeFile: vi.fn(async () => { throw new Error('EACCES: permission denied') }) })

    const result = await saveAttachment('a.txt', 7, '/tmp', d)

    expect(result).toEqual({ success: false, error: 'EACCES: permission denied' })
  })
})
