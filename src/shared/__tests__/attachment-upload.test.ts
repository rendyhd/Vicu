import { describe, expect, it } from 'vitest'
import { readUploadAnswer } from '../attachment-upload'

describe('readUploadAnswer', () => {
  it('reads what the server stored', () => {
    expect(readUploadAnswer({ success: [{ id: 3 }], errors: null })).toEqual({ attachments: [{ id: 3 }], error: null })
  })
  it('reads why a file was refused, which comes with a 201', () => {
    expect(readUploadAnswer({ success: null, errors: [{ code: 4005, message: 'too big' }] })).toEqual({ attachments: [], error: 'too big' })
  })
  it('has something to say about a refusal without a message', () => {
    expect(readUploadAnswer({ errors: [{}] }).error).toBe('The server refused the file')
  })
  it('takes anything else as nothing stored and nothing refused', () => {
    for (const data of [undefined, null, 'x', 5, {}]) {
      expect(readUploadAnswer(data)).toEqual({ attachments: [], error: null })
    }
  })
})
