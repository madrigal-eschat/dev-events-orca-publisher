import type { PluginEvents } from 'orca/worker'
import { describe, expect, test } from 'vitest'
import { mapOrcaEvent } from '../../src/events/mapping'
import { createDefaultSettings } from '../../src/settings/settings'

type AgentStatus = PluginEvents['agent.status.changed']
type AgentOutcome = NonNullable<AgentStatus['mainAgent']>['outcome']

function agentStatus(state: AgentStatus['state'], outcome?: AgentOutcome): AgentStatus {
  return {
    workspaceId: 'workspace-secret',
    paneKey: 'pane-secret',
    terminalId: 'terminal-secret',
    title: 'private agent title',
    state,
    receivedAt: 1,
    ...(outcome === undefined ? {} : { mainAgent: { state, outcome, stateStartedAt: 1 } })
  }
}

function settings() {
  const value = createDefaultSettings('orca-client')
  value.eventModes['devevents.agent.turn.started'] = 'FULL'
  value.eventModes['devevents.agent.turn.ended'] = 'FULL'
  return value
}

describe('Orca-to-dev-events mapping', () => {
  test.each([
    ['working', undefined, 'devevents.agent.turn.started', {}],
    ['blocked', undefined, 'devevents.agent.turn.ended', { reason: 'waiting' }],
    ['waiting', undefined, 'devevents.agent.turn.ended', { reason: 'waiting' }],
    ['done', 'success', 'devevents.agent.turn.ended', { reason: 'finished' }],
    ['done', 'failure', 'devevents.agent.turn.ended', { reason: 'failed' }],
    ['done', 'cancellation', 'devevents.agent.turn.ended', { reason: 'interrupted' }],
    ['done', 'interruption', 'devevents.agent.turn.ended', { reason: 'interrupted' }],
    ['done', 'superseded', 'devevents.agent.turn.ended', { reason: 'interrupted' }]
  ] as const)(
    'maps state %s and outcome %s to the allowlisted event',
    (state, outcome, type, data) => {
      expect(mapOrcaEvent('agent.status.changed', agentStatus(state, outcome), settings())).toEqual(
        {
          type,
          payload: { data }
        }
      )
    }
  )

  test.each([
    ['working', 'devevents.agent.turn.started'],
    ['blocked', 'devevents.agent.turn.ended'],
    ['waiting', 'devevents.agent.turn.ended'],
    ['done', 'devevents.agent.turn.ended']
  ] as const)('omits state %s when its event type is OFF', (state, type) => {
    const value = settings()
    value.eventModes[type] = 'OFF'

    expect(
      mapOrcaEvent('agent.status.changed', agentStatus(state, 'success'), value)
    ).toBeUndefined()
  })

  test.each(['FULL', 'REDACTED'] as const)('maps a reason in %s mode', (mode) => {
    const value = settings()
    value.eventModes['devevents.agent.turn.ended'] = mode

    expect(mapOrcaEvent('agent.status.changed', agentStatus('done', 'success'), value)).toEqual({
      type: 'devevents.agent.turn.ended',
      payload: { data: { reason: 'finished' } }
    })
  })

  test.each([undefined, 'unconfirmed'] as const)(
    'omits done events without a confirmed outcome (%s)',
    (outcome) => {
      expect(
        mapOrcaEvent('agent.status.changed', agentStatus('done', outcome), settings())
      ).toBeUndefined()
    }
  )

  test('ignores malformed status payloads', () => {
    expect(mapOrcaEvent('agent.status.changed', null as never, settings())).toBeUndefined()
    expect(
      mapOrcaEvent('agent.status.changed', { state: 'unknown' } as AgentStatus, settings())
    ).toBeUndefined()
    expect(
      mapOrcaEvent(
        'agent.status.changed',
        { state: 'done', mainAgent: null } as AgentStatus,
        settings()
      )
    ).toBeUndefined()
  })

  test.each([
    'workspace.created',
    'workspace.removed',
    'workspace.changed',
    'editor.save.before',
    'agent.launch.before',
    'agent.prompt.before',
    'task.started',
    'test.finished'
  ])('does not map unsupported Orca signal %s', (eventName) => {
    expect(mapOrcaEvent(eventName, agentStatus('working'), settings())).toBeUndefined()
  })
})
