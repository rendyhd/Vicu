import { describe, expect, it } from 'vitest'
import { buildCreateExtras, stripPendingImageTokens } from '../composer-queue'
import type { Label } from '../vikunja-types'

const label = (id: number, title: string): Label => ({ id, title, hex_color: '', created: '', updated: '' })
const bytes = new Uint8Array([1, 2, 3])

describe('stripPendingImageTokens', () => {
  it('removes the placeholders of images that have not been uploaded, keeping the text', () => {
    expect(stripPendingImageTokens('Intro\n[[image-pending:ab-12]]\nOutro')).toBe('Intro\nOutro')
    expect(stripPendingImageTokens('[[image-pending:x1]]')).toBe('')
  })

  it('keeps a real image token', () => {
    expect(stripPendingImageTokens('See [[image:42]]')).toBe('See [[image:42]]')
  })
})

describe('buildCreateExtras (what the queue keeps with a create made offline)', () => {
  const home = label(1, 'Home')
  const work = label(2, 'Work')

  it('queues explicit labels by id and parsed labels by title, matching known labels case-insensitively', () => {
    const extras = buildCreateExtras({
      explicitLabels: [home],
      parsedLabelNames: ['work', 'Garden', 'home'],
      knownLabels: [home, work],
      attachments: [],
      description: '',
    })

    expect(extras.labels).toEqual([
      { id: 1, title: 'Home' },
      { id: 2, title: 'Work' },
      { title: 'Garden' },
    ])
    expect(extras.displayLabels).toEqual([home, work])
  })

  it('queues pasted images as inline images and attached files as plain attachments', () => {
    const extras = buildCreateExtras({
      explicitLabels: [],
      parsedLabelNames: [],
      knownLabels: [],
      attachments: [
        { name: 'shot.png', mime: 'image/png', bytes, pendingToken: 'u1' },
        { name: 'report.pdf', mime: 'application/pdf', bytes },
      ],
      description: 'Look: [[image-pending:u1]]',
    })

    expect(extras.images).toEqual([
      { name: 'shot.png', mime: 'image/png', bytes },
      { name: 'report.pdf', mime: 'application/pdf', bytes, inline: false },
    ])
    // The queue appends the real token after the upload, so the placeholder must not be kept.
    expect(extras.queuedDescription).toBe('Look: ')
  })

  it('leaves the description alone when there is nothing to strip', () => {
    const extras = buildCreateExtras({ explicitLabels: [], parsedLabelNames: [], knownLabels: [], attachments: [], description: 'plain' })
    expect(extras.queuedDescription).toBeUndefined()
    expect(extras.images).toBeUndefined()
    expect(extras.labels).toBeUndefined()
  })
})
