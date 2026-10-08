import { beforeEach, describe, expect, it } from 'vitest'
import { NEW_TASK_REQUEST_TTL_MS, useNewTaskRequestStore } from '../new-task-request-store'

describe('new task request store', () => {
  beforeEach(() => {
    useNewTaskRequestStore.setState({ requestedAt: null })
  })

  it('has nothing to take at first', () => {
    expect(useNewTaskRequestStore.getState().take()).toBe(false)
  })

  it('hands a request to the first list that takes it, once', () => {
    const { request, take } = useNewTaskRequestStore.getState()
    request(1000)
    expect(take(1500)).toBe(true)
    expect(take(1600)).toBe(false)
    expect(useNewTaskRequestStore.getState().requestedAt).toBeNull()
  })

  it('drops a request that waited too long', () => {
    const { request, take } = useNewTaskRequestStore.getState()
    request(1000)
    expect(take(1000 + NEW_TASK_REQUEST_TTL_MS + 1)).toBe(false)
    expect(useNewTaskRequestStore.getState().requestedAt).toBeNull()
  })
})
