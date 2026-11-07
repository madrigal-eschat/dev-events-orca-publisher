import type { OrcaWorkerApi } from 'orca/worker'
import { expect, test, vi } from 'vitest'
import { registerOrcaEventAdapter } from '../../src/events/orca-adapter'
import { createDefaultSettings } from '../../src/settings/settings'

function settings() {
  const value = createDefaultSettings('orca-client')
  value.eventModes['devevents.agent.turn.ended'] = 'FULL'
  return value
}

test('subscribes only to agent status and publishes its mapped event', () => {
  let onStatusChanged: ((payload: unknown) => void) | undefined
  const disposable = { dispose: vi.fn() }
  const orca = {
    events: {
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        if (event === 'agent.status.changed') {
          onStatusChanged = handler
        }
        return disposable
      })
    }
  } as unknown as OrcaWorkerApi
  const onMappedEvent = vi.fn()

  const subscription = registerOrcaEventAdapter(orca, settings(), onMappedEvent)
  onStatusChanged?.({
    workspaceId: null,
    paneKey: 'pane-secret',
    state: 'blocked',
    receivedAt: 10
  })

  expect(orca.events.on).toHaveBeenCalledTimes(1)
  expect(orca.events.on).toHaveBeenCalledWith('agent.status.changed', expect.any(Function))
  expect(onMappedEvent).toHaveBeenCalledWith({
    type: 'devevents.agent.turn.ended',
    payload: { data: { reason: 'waiting' } }
  })
  expect(subscription).toBe(disposable)
})

test('does not forward events disabled by settings', () => {
  let onStatusChanged: ((payload: unknown) => void) | undefined
  const orca = {
    events: {
      on: vi.fn((_event: string, handler: (payload: unknown) => void) => {
        onStatusChanged = handler
        return { dispose: vi.fn() }
      })
    }
  } as unknown as OrcaWorkerApi
  const onMappedEvent = vi.fn()

  registerOrcaEventAdapter(orca, createDefaultSettings('orca-client'), onMappedEvent)
  onStatusChanged?.({
    workspaceId: null,
    paneKey: 'pane-secret',
    state: 'working',
    receivedAt: 10
  })

  expect(onMappedEvent).not.toHaveBeenCalled()
})

test('ignores a done status without a confirmed outcome', () => {
  let onStatusChanged: ((payload: unknown) => void) | undefined
  const orca = {
    events: {
      on: vi.fn((_event: string, handler: (payload: unknown) => void) => {
        onStatusChanged = handler
        return { dispose: vi.fn() }
      })
    }
  } as unknown as OrcaWorkerApi
  const onMappedEvent = vi.fn()

  registerOrcaEventAdapter(orca, settings(), onMappedEvent)
  onStatusChanged?.({
    workspaceId: null,
    paneKey: 'pane-secret',
    state: 'done',
    receivedAt: 10,
    mainAgent: { state: 'done', stateStartedAt: 10 }
  })

  expect(onMappedEvent).not.toHaveBeenCalled()
})
