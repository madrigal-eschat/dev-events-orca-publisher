import { describe, expect, test } from 'vitest'
import { buildEnvelope, buildTopic } from '../../src/mqtt/envelope'
import type { EventType } from '../../src/settings/settings'

const TIME = new Date('2026-11-07T16:00:00.000Z')
const ID = '550e8400-e29b-41d4-a716-446655440000'

describe('CloudEvents envelope construction', () => {
  test('builds the editor CloudEvent envelope', () => {
    expect(
      buildEnvelope(
        'devevents.file.saved',
        { file_path: 'src/index.ts' },
        'telyn',
        '~/project',
        TIME,
        ID
      )
    ).toEqual({
      specversion: '1.0',
      id: ID,
      type: 'devevents.file.saved',
      source: 'editor/telyn/orca',
      sourcetype: 'editor',
      subject: '~/project',
      time: '2026-11-07T16:00:00.000Z',
      data: { file_path: 'src/index.ts' }
    })
  })

  test('includes already-safe event data', () => {
    expect(
      buildEnvelope(
        'devevents.file.saved',
        { file_path: 'src/index.ts' },
        'telyn',
        undefined,
        TIME,
        ID
      )
    ).toEqual({
      specversion: '1.0',
      id: ID,
      type: 'devevents.file.saved',
      source: 'editor/telyn/orca',
      sourcetype: 'editor',
      time: '2026-11-07T16:00:00.000Z',
      data: { file_path: 'src/index.ts' }
    })
  })

  test('rejects event types outside the dev-events catalog', () => {
    expect(() =>
      buildEnvelope('devevents.unknown' as EventType, {}, 'telyn', undefined, TIME, ID)
    ).toThrow('Unsupported dev-events type: devevents.unknown')
  })

  test('includes the privacy-filtered agent turn-end reason', () => {
    expect(
      buildEnvelope(
        'devevents.agent.turn.ended',
        { reason: 'finished' },
        'telyn',
        undefined,
        TIME,
        ID
      ).data
    ).toEqual({ reason: 'finished' })
  })

  test('includes the hostname in the topic only when enabled', () => {
    expect(buildTopic('dev-events', 'telyn', true)).toBe('dev-events/telyn')
    expect(buildTopic('dev-events', 'telyn', false)).toBe('dev-events')
  })
})
