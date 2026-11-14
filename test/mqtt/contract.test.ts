import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import { describe, expect, test } from 'vitest'
import { buildEnvelope } from '../../src/mqtt/envelope'
import type { SafePayload } from '../../src/privacy/payload'
import { EVENT_TYPES, type EventType } from '../../src/settings/settings'

const schema = JSON.parse(
  readFileSync(new URL('../../schemas/devevents.schema.json', import.meta.url), 'utf8')
) as object
const validate = new Ajv().compile(schema)
const TIME = new Date('2026-11-07T16:00:00.000Z')
const ID = '550e8400-e29b-41d4-a716-446655440000'

const dataByType: Record<EventType, SafePayload['data']> = {
  'devevents.task.started': { name: 'build' },
  'devevents.task.succeeded': { duration_ms: 10, name: 'build' },
  'devevents.task.failed': { duration_ms: 10, exit_code: 1, name: 'build' },
  'devevents.test.started': {},
  'devevents.test.succeeded': { duration_ms: 10, passed: 1, failed: 0, skipped: 0 },
  'devevents.test.failed': { duration_ms: 10, passed: 0, failed: 1, skipped: 0 },
  'devevents.file.saved': { file_path: 'src/index.ts' },
  'devevents.file.opened': { file_path: 'src/index.ts' },
  'devevents.file.closed': { file_path: 'src/index.ts' },
  'devevents.breakpoint.hit': { file_path: 'src/index.ts', line: 42 },
  'devevents.vcs.committed': {},
  'devevents.vcs.pushed': {},
  'devevents.vcs.branch.changed': { branch: 'main' },
  'devevents.editor.focus.gained': {},
  'devevents.editor.focus.lost': {},
  'devevents.keypresses': { count: 1 },
  'devevents.agent.started': { worktree: '~/project' },
  'devevents.agent.turn.started': { worktree: '~/project' },
  'devevents.agent.turn.ended': { reason: 'finished', worktree: '~/project' },
  'devevents.agent.exited': { worktree: '~/project' }
}

describe('dev-events envelope contract', () => {
  test('validates every supported generated message against the protocol schema', () => {
    for (const type of EVENT_TYPES) {
      const message = buildEnvelope(type, dataByType[type], 'telyn', undefined, TIME, ID)
      expect(validate(message), `${type}: ${JSON.stringify(validate.errors)}`).toBe(true)
      expect(JSON.stringify(message)).not.toContain('null')
    }
  })

  test('rejects null optional values and undocumented envelope fields', () => {
    const message = buildEnvelope('devevents.file.saved', {}, 'telyn', undefined, TIME, ID)
    expect(validate({ ...message, data: { file_path: null } })).toBe(false)
    expect(validate({ ...message, password: 'secret' })).toBe(false)
  })
})
