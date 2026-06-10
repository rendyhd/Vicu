import { describe, it, expect, beforeEach } from 'vitest'
import { usePrintStore } from '../print-store'

describe('print store', () => {
  beforeEach(() => {
    usePrintStore.setState({ payload: null })
  })

  it('starts with no payload', () => {
    expect(usePrintStore.getState().payload).toBeNull()
  })

  it('stores and clears a payload', () => {
    const payload = { viewTitle: 'Today', sections: [] }
    usePrintStore.getState().setPayload(payload)
    expect(usePrintStore.getState().payload).toBe(payload)
    usePrintStore.getState().clearPayload()
    expect(usePrintStore.getState().payload).toBeNull()
  })
})
