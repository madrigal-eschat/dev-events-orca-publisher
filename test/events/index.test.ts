import { connect as mqttConnect } from 'mqtt'
import type { OrcaWorkerApi } from 'orca/worker'
import { expect, test, vi } from 'vitest'
import { activatePublisher } from '../../src/index'
import type { MqttClientLike } from '../../src/mqtt/publisher'

vi.mock('mqtt', () => ({ connect: vi.fn() }))

class FakeClient implements MqttClientLike {
  readonly listeners: Array<() => void> = []
  readonly published: Array<{ topic: string; message: string; qos: 0 }> = []

  on(event: 'connect' | 'reconnect' | 'close', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(
    event: 'connect' | 'reconnect' | 'close' | 'error',
    listener: (() => void) | ((error: Error) => void)
  ): this {
    if (event === 'connect') {
      this.listeners.push(listener as () => void)
    }
    return this
  }

  publish(
    topic: string,
    message: string,
    options: { qos: 0 },
    callback: (error?: Error | null) => void
  ): void {
    this.published.push({ topic, message, qos: options.qos })
    callback()
  }

  end(_force: boolean, callback: (error?: Error | null) => void): this {
    callback()
    return this
  }

  connect(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

test('activates the publisher and forwards only mapped agent turn events', async () => {
  const handlers = new Map<string, (payload: unknown) => void>()
  const settingValues: Record<string, string | boolean> = {
    brokerUrl: 'tcp://localhost:1883',
    username: '',
    clientId: 'orca-client',
    topicPrefix: 'dev-events',
    includeHost: true,
    hostLabel: 'workstation',
    homeSubnet: '',
    includeProject: true,
    agentTurnStartedMode: 'FULL',
    agentTurnEndedMode: 'OFF'
  }
  const client = new FakeClient()
  vi.mocked(mqttConnect).mockReturnValue(client as ReturnType<typeof mqttConnect>)
  const orca = {
    settings: {
      get: vi.fn(async (key: string) => settingValues[key]),
      set: vi.fn(),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() }))
    },
    secrets: { get: vi.fn().mockResolvedValue(null) },
    log: vi.fn(),
    host: { call: vi.fn().mockResolvedValue({ ok: true }) },
    events: {
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler)
        return { dispose: vi.fn() }
      })
    }
  } as unknown as OrcaWorkerApi

  const cleanup = await activatePublisher(orca)
  client.connect()
  handlers.get('agent.status.changed')?.({
    workspaceId: 'private-workspace-id',
    paneKey: 'private-pane',
    terminalId: 'private-terminal',
    title: 'private title',
    state: 'working',
    receivedAt: 123,
    mainAgent: { state: 'working', stateStartedAt: 123 }
  })

  expect(Array.from(handlers.keys())).toEqual(['agent.status.changed'])
  expect(orca.log).toHaveBeenCalledWith('MQTT connection state: connecting')
  expect(orca.log).toHaveBeenCalledWith('MQTT connection state: connected')
  expect(orca.host.call).toHaveBeenCalledWith('statusBar.update', {
    id: 'mqtt-status',
    text: 'MQTT: Connected',
    icon: 'plug',
    tone: 'success',
    tooltip: 'MQTT connection state: connected'
  })
  expect(client.published).toHaveLength(1)
  expect(JSON.parse(client.published[0]?.message ?? '')).toMatchObject({
    type: 'devevents.agent.turn.started',
    data: {},
    source: 'editor/workstation/orca'
  })
  await cleanup()
})
