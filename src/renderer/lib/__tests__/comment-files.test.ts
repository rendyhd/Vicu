import { describe, expect, it } from 'vitest'
import type { CommentAttachment } from '../collaboration'
import {
  commentAttachmentsOf,
  commentBlocks,
  fileDisplayName,
  filesToAttach,
  isFileGone,
  viewerImagesOf,
  type CommentFileList,
} from '../comment-files'
import type { TaskAttachment } from '../vikunja-types'

const attachment = (id: number, name: string, mime: string): TaskAttachment =>
  ({ id, task_id: 7, created: '', created_by: { id: 1, username: 'me' }, file: { id, name, mime, size: 10 } }) as TaskAttachment

const image: CommentAttachment = { attachment: 3, name: 'from the comment', image: true, url: '/api/v1/tasks/7/attachments/3' }
const link: CommentAttachment = { attachment: 4, name: 'notes.txt', image: false, url: '/api/v1/tasks/7/attachments/4' }

const listOf = (read: boolean, ...files: TaskAttachment[]): CommentFileList => ({ known: new Map(files.map((f) => [f.id, f])), read })

describe('commentBlocks', () => {
  it('keeps text and mentions in one run and each attachment on its own, in reading order', () => {
    const blocks = commentBlocks([{ text: 'Hi ' }, { mention: 'maya', label: 'Maya' }, image, link, { text: 'after' }])
    expect(blocks).toEqual([
      { kind: 'text', segments: [{ text: 'Hi ' }, { mention: 'maya', label: 'Maya' }] },
      { kind: 'file', file: image },
      { kind: 'file', file: link },
      { kind: 'text', segments: [{ text: 'after' }] },
    ])
  })
  it('has no block for an empty comment', () => {
    expect(commentBlocks([])).toEqual([])
  })
})

describe('what is known about a file', () => {
  it('counts a file as gone only when the list is newer than the thread', () => {
    expect(isFileGone(image, listOf(true))).toBe(true)
    expect(isFileGone(image, listOf(false))).toBe(false)
    expect(isFileGone(image, listOf(true, attachment(3, 'shot.png', 'image/png')))).toBe(false)
  })
  it('names a file after the list, then the comment, then its kind', () => {
    expect(fileDisplayName(image, listOf(true, attachment(3, 'shot.png', 'image/png')))).toBe('shot.png')
    expect(fileDisplayName(image, listOf(false))).toBe('from the comment')
    expect(fileDisplayName({ ...image, name: '' }, listOf(false))).toBe('Image')
    expect(fileDisplayName({ ...link, name: '' }, listOf(false))).toBe('File')
  })
})

describe('viewerImagesOf', () => {
  it('takes the images only, without the ones that are gone', () => {
    const other: CommentAttachment = { ...image, attachment: 5 }
    const images = viewerImagesOf([image, link, other], listOf(true, attachment(3, 'shot.png', 'image/png'), attachment(4, 'notes.txt', 'text/plain')))
    expect(images).toEqual([{ id: 3, name: 'shot.png', mime: 'image/png' }])
  })
  it('leaves out a file the viewer could not draw, and assumes an image while the list is not read', () => {
    expect(viewerImagesOf([image], listOf(true, attachment(3, 'scan.heic', 'image/heic')))).toEqual([])
    expect(viewerImagesOf([image], listOf(false))).toEqual([{ id: 3, name: 'from the comment', mime: 'image/png' }])
  })
})

describe('commentAttachmentsOf', () => {
  it('writes the types every browser shows as images and anything else as links', () => {
    const files = [attachment(3, 'shot.png', 'image/png'), attachment(4, 'notes.txt', 'text/plain; charset=utf-8'), attachment(5, 'scan.heic', 'image/heic')]
    expect(commentAttachmentsOf(files, 'https://todo.example.com/', 7)).toEqual([
      { attachment: 3, name: 'shot.png', image: true, url: 'https://todo.example.com/api/v1/tasks/7/attachments/3' },
      { attachment: 4, name: 'notes.txt', image: false, url: 'https://todo.example.com/api/v1/tasks/7/attachments/4' },
      { attachment: 5, name: 'scan.heic', image: false, url: 'https://todo.example.com/api/v1/tasks/7/attachments/5' },
    ])
  })
})

describe('filesToAttach', () => {
  it('gives a file without a type or name something to send', () => {
    const file = new File(['x'], '', { type: '' })
    expect(filesToAttach([file])[0]).toMatchObject({ name: 'File', mime: 'application/octet-stream' })
  })
})
