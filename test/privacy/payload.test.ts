import { describe, expect, test } from 'vitest'
import { DeveventsPayload } from '../../src/privacy/payload'

describe('DeveventsPayload', () => {
  test('holds its reason as payload data', () => {
    const payload = new DeveventsPayload()
    payload.addReason('finished')

    expect(payload.toSafePayload(undefined)).toEqual({ data: { reason: 'finished' } })
  })

  test('creates a safe payload with a subject', () => {
    const payload = new DeveventsPayload()

    expect(payload.toSafePayload('~/project')).toEqual({ data: {}, subject: '~/project' })
  })

  test('creates a safe payload without an undefined subject', () => {
    const payload = new DeveventsPayload()

    expect(payload.toSafePayload(undefined)).toEqual({ data: {} })
  })
})
