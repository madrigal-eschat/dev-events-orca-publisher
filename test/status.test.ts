import { describe, expect, test, vi } from 'vitest'
import { createDefaultSettings } from '../src/settings/settings'
import { createStatusReporter, warnIfAllEventsOff } from '../src/status'

describe('publisher status reporting', () => {
  test('logs each connection transition and the latest sanitized error', () => {
    const log = vi.fn<(message: string) => void>()
    const updateStatusBar = vi.fn()
    const report = createStatusReporter(log, updateStatusBar)

    report({ connectionState: 'disconnected', lastError: null })
    report({ connectionState: 'connecting', lastError: null })
    report({ connectionState: 'connected', lastError: null })
    report({ connectionState: 'error', lastError: 'publish_failed' })
    report({ connectionState: 'connected', lastError: 'publish_failed' })

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'MQTT connection state: disconnected',
      'MQTT connection state: connecting',
      'MQTT connection state: connected',
      'MQTT connection state: error',
      'MQTT latest error: publish_failed',
      'MQTT connection state: connected'
    ])
    expect(updateStatusBar).toHaveBeenLastCalledWith({
      id: 'mqtt-status',
      text: 'MQTT: Connected',
      icon: 'plug',
      tone: 'success',
      tooltip: 'MQTT connection state: connected; latest error: publish_failed'
    })
  })

  test('logs the reason on each failed reconnect without logging duplicate snapshots', () => {
    const log = vi.fn<(message: string) => void>()
    const report = createStatusReporter(log, vi.fn())
    const failure = { connectionState: 'error', lastError: 'connection_refused' } as const

    report(failure)
    report(failure)
    report({ ...failure, connectionState: 'disconnected' })
    report({ ...failure, connectionState: 'connecting' })
    report(failure)

    expect(log.mock.calls.flat()).toEqual([
      'MQTT connection state: error',
      'MQTT latest error: connection_refused',
      'MQTT connection state: disconnected',
      'MQTT connection state: connecting',
      'MQTT connection state: error',
      'MQTT latest error: connection_refused'
    ])
  })

  test('never reports arbitrary diagnostic text or private values', () => {
    const log = vi.fn<(message: string) => void>()
    const updateStatusBar = vi.fn()
    const report = createStatusReporter(log, updateStatusBar)
    const privateText =
      'username alice password p@ss payload prompt output file contents /private/worktree'

    report({ connectionState: 'error', lastError: privateText })

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'MQTT connection state: error',
      'MQTT latest error: mqtt_error'
    ])
    expect(updateStatusBar).toHaveBeenCalledWith(
      expect.objectContaining({ tooltip: 'MQTT connection state: error; latest error: mqtt_error' })
    )
    expect(
      JSON.stringify({ logs: log.mock.calls, updates: updateStatusBar.mock.calls })
    ).not.toContain(privateText)
  })

  test('normalizes an invalid runtime connection state without exposing its value', () => {
    const log = vi.fn<(message: string) => void>()
    const updateStatusBar = vi.fn()
    const report = createStatusReporter(log, updateStatusBar)
    const privateState = 'username=alice password=secret payload=private prompt=hidden'

    report({ connectionState: privateState as never, lastError: null })

    expect(log.mock.calls.map(([message]) => message)).toEqual(['MQTT connection state: error'])
    expect(updateStatusBar).toHaveBeenCalledWith({
      id: 'mqtt-status',
      text: 'MQTT: Error',
      icon: 'plug',
      tone: 'danger',
      tooltip: 'MQTT connection state: error'
    })
    expect(
      JSON.stringify({ logs: log.mock.calls, updates: updateStatusBar.mock.calls })
    ).not.toContain(privateState)
  })

  test('warns at startup when every event is disabled without logging settings', () => {
    const log = vi.fn<(message: string) => void>()

    warnIfAllEventsOff(log, createDefaultSettings('private-client-id'))

    expect(log).toHaveBeenCalledWith('All publisher events are disabled')
    expect(log.mock.calls.flat().join(' ')).not.toContain('private-client-id')
  })
})
