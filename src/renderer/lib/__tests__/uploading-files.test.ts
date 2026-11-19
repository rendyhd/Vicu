import { describe, expect, it } from 'vitest'
import { hasLanded, uploadingStatus, uploadsToShow, type UploadingFile } from '../uploading-files'

const upload = (over: Partial<UploadingFile> = {}): UploadingFile => ({
  key: 1,
  taskId: 42,
  name: 'report.pdf',
  size: 2_516_582,
  knownIds: [8],
  ...over,
})

const attachment = (id: number, name: string) => ({ id, file: { name } })

describe('uploading files', () => {
  it('says the size under the name', () => {
    expect(uploadingStatus(2_516_582)).toBe('Uploading · 2.4 MB')
  })

  it('shows a file until the attachment it made is listed', () => {
    const u = upload({ attachmentId: 9 })
    expect(uploadsToShow([u], 42, [attachment(8, 'old.txt')])).toEqual([u])
    expect(uploadsToShow([u], 42, [attachment(8, 'old.txt'), attachment(9, 'report.pdf')])).toEqual([])
  })

  it('a new attachment of the same name counts before the server answered, an old one does not', () => {
    const u = upload({ knownIds: [8] })
    expect(hasLanded(u, [attachment(8, 'report.pdf')])).toBe(false)
    expect(hasLanded(u, [attachment(8, 'report.pdf'), attachment(9, 'report.pdf')])).toBe(true)
  })

  it('only shows the uploads of the task asked for', () => {
    expect(uploadsToShow([upload({ taskId: 7 })], 42, [])).toEqual([])
  })
})
