import { connect as mqttConnect } from 'mqtt'
import type { JsonValue } from 'orca/host'
import type { OrcaWorkerApi } from 'orca/worker'
import { beforeEach, expect, test, vi } from 'vitest'
import { activatePublisher } from '../../src/index'
import type { MqttClientLike } from '../../src/mqtt/publisher'

vi.mock('mqtt', () => ({ connect: vi.fn() }))

class FakeClient implements MqttClientLike {
  readonly published: Array<{ topic: string; message: string; qos: 0 }> = []
  readonly endCalls: Array<{ force: boolean; callback: (error?: Error | null) => void }> = []
  readonly listeners: {
    connect: Array<() => void>
    reconnect: Array<() => void>
    close: Array<() => void>
    error: Array<(error: Error) => void>
  } = { connect: [], reconnect: [], close: [], error: [] }
  autoCompleteEnd = true

  on(event: 'connect' | 'reconnect' | 'close', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(
    event: 'connect' | 'reconnect' | 'close' | 'error',
    listener: (() => void) | ((error: Error) => void)
  ): this {
    if (event === 'error') {
      this.listeners.error.push(listener as (error: Error) => void)
    } else {
      this.listeners[event].push(listener as () => void)
    }
    return this
  }

  publish(topic: string, message: string, options: { qos: 0 }): void {
    this.published.push({ topic, message, qos: options.qos })
  }

  end(force: boolean, callback: (error?: Error | null) => void): this {
    this.endCalls.push({ force, callback })
    if (this.autoCompleteEnd) {
      callback()
    }
    return this
  }

  emit(event: 'connect' | 'reconnect' | 'close'): void {
    for (const listener of this.listeners[event]) {
      listener()
    }
  }
}

function createActivation(initialValues: Record<string, JsonValue> = {}) {
  const values = new Map<string, JsonValue>(
    Object.entries({
      brokerUrl: 'tcp://localhost:1883',
      username: '',
      clientId: 'native-client-id',
      topicPrefix: 'dev-events',
      includeHost: true,
      hostLabel: '',
      homeSubnet: '',
      includeProject: true,
      agentTurnStartedMode: 'FULL',
      agentTurnEndedMode: 'OFF',
      ...initialValues
    })
  )
  const clients: FakeClient[] = []
  const getSetting = vi.fn(async (key: string) => values.get(key))
  const settingsDisposable = { dispose: vi.fn() }
  const eventDisposable = { dispose: vi.fn() }
  const panelDisposables = [{ dispose: vi.fn() }, { dispose: vi.fn() }]
  const panelHandlers = new Map<
    string,
    (input: unknown, context: { panel: { contributionId: string } }) => unknown
  >()
  let settingsChange: (() => void) | undefined
  let eventHandler: ((payload: unknown) => void) | undefined
  const settings = {
    get: getSetting,
    set: vi.fn(async (key: string, value: JsonValue) => {
      values.set(key, value)
    }),
    onDidChange: vi.fn((listener: (change: { key: string }) => void) => {
      settingsChange = () => listener({ key: 'brokerUrl' })
      return settingsDisposable
    })
  }
  const secrets = { get: vi.fn(async () => 'broker-secret') }
  const storage = { get: vi.fn() }
  const events = {
    on: vi.fn((_name: string, listener: (payload: unknown) => void) => {
      eventHandler = listener
      return eventDisposable
    })
  }
  const log = vi.fn()
  const host = { call: vi.fn() }
  const panels = {
    handle: vi.fn(
      (
        name: string,
        handler: (input: unknown, context: { panel: { contributionId: string } }) => unknown
      ) => {
        panelHandlers.set(name, handler)
        return panelDisposables[panelHandlers.size - 1]
      }
    )
  }
  const orca = { settings, secrets, storage, events, panels, log, host } as unknown as OrcaWorkerApi
  vi.mocked(mqttConnect).mockImplementation(() => {
    const client = new FakeClient()
    clients.push(client)
    return client as never
  })

  return {
    orca,
    clients,
    values,
    getSetting,
    secrets,
    settingsDisposable,
    eventDisposable,
    panelDisposables,
    panelHandlers,
    settingsChange: () => settingsChange?.(),
    event: (payload: unknown) => eventHandler?.(payload),
    log,
    storage
  }
}

beforeEach(() => {
  vi.mocked(mqttConnect).mockReset()
})

test('logs the broker address and login attempts on connect and reconnect without credentials', async () => {
  const activation = createActivation({
    brokerUrl: 'wss://broker.example:9443/mqtt?token=private-query',
    username: 'private-username'
  })
  const cleanup = await activatePublisher(activation.orca)
  activation.clients[0]?.emit('reconnect')

  expect(activation.log.mock.calls.flat().filter((message) => message.includes('attempt'))).toEqual(
    [
      'MQTT connection attempt: wss://broker.example:9443',
      'MQTT login attempt: using configured credentials',
      'MQTT connection attempt: wss://broker.example:9443',
      'MQTT login attempt: using configured credentials'
    ]
  )
  expect(JSON.stringify(activation.log.mock.calls)).not.toMatch(
    /private-query|private-username|broker-secret/
  )
  await cleanup()
})

test('logs a broker address without a login attempt when no credentials are configured', async () => {
  const activation = createActivation()
  activation.secrets.get.mockResolvedValue('')
  const cleanup = await activatePublisher(activation.orca)

  expect(activation.log.mock.calls.flat().filter((message) => message.includes('attempt'))).toEqual(
    ['MQTT connection attempt: tcp://localhost:1883']
  )
  await cleanup()
})

test('loads Orca settings and password, replacing the publisher on settings changes', async () => {
  const activation = createActivation()

  const cleanup = await activatePublisher(activation.orca)

  expect(activation.getSetting).toHaveBeenCalledWith('brokerUrl')
  expect(activation.storage.get).not.toHaveBeenCalled()
  expect(mqttConnect).toHaveBeenCalledWith('tcp://localhost:1883', {
    clientId: 'native-client-id',
    password: 'broker-secret'
  })
  expect(activation.orca.events.on).toHaveBeenCalledTimes(1)
  activation.clients[0]?.emit('connect')
  activation.event({ workspaceId: null, paneKey: 'pane-secret', state: 'working', receivedAt: 10 })
  expect(activation.clients[0]?.published).toHaveLength(1)

  activation.values.set('brokerUrl', 'mqtts://new-broker.example:8883')
  activation.values.set('agentTurnStartedMode', 'OFF')
  activation.values.set('agentTurnEndedMode', 'FULL')
  activation.settingsChange()
  await vi.waitFor(() => expect(mqttConnect).toHaveBeenCalledTimes(2))

  expect(activation.clients[0]?.endCalls).toHaveLength(1)
  expect(activation.clients[0]?.endCalls[0]?.force).toBe(false)
  activation.clients[1]?.emit('connect')
  activation.event({
    workspaceId: null,
    paneKey: 'pane-secret',
    state: 'blocked',
    receivedAt: 11
  })
  expect(activation.clients[0]?.published).toHaveLength(1)
  expect(activation.clients[1]?.published).toHaveLength(1)
  expect(mqttConnect).toHaveBeenLastCalledWith('mqtts://new-broker.example:8883', {
    clientId: 'native-client-id',
    password: 'broker-secret'
  })
  expect(activation.orca.events.on).toHaveBeenCalledTimes(1)

  await cleanup()
})

test('registers password requests that return only safe results', async () => {
  const activation = createActivation()

  const cleanup = await activatePublisher(activation.orca)
  const context = { panel: { contributionId: 'mqtt-credentials' } }
  const status = activation.panelHandlers.get('publisher.passwordStatus')
  const changed = activation.panelHandlers.get('publisher.credentialsChanged')

  expect(activation.orca.panels.handle).toHaveBeenCalledTimes(2)
  expect([...activation.panelHandlers.keys()]).toEqual([
    'publisher.passwordStatus',
    'publisher.credentialsChanged'
  ])
  expect(status).toBeDefined()
  expect(changed).toBeDefined()
  await expect(status?.(undefined, context)).resolves.toEqual({ configured: true })
  await expect(changed?.(undefined, context)).resolves.toEqual({ refreshStarted: true })
  expect(activation.clients).toHaveLength(2)
  expect(activation.clients[0]?.endCalls).toHaveLength(1)
  expect(JSON.stringify([...activation.panelHandlers.keys()])).not.toContain('broker-secret')
  expect(JSON.stringify({ status: await status?.(undefined, context) })).not.toContain(
    'broker-secret'
  )

  await cleanup()
})

test('rejects password requests from other panel contributions', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  const context = { panel: { contributionId: 'untrusted-panel' } }

  for (const name of ['publisher.passwordStatus', 'publisher.credentialsChanged']) {
    const handler = activation.panelHandlers.get(name)
    await expect(handler?.(undefined, context)).rejects.toThrow()
  }

  expect(activation.clients).toHaveLength(1)
  await cleanup()
})

test('rejects failed panel refreshes with a sanitized worker error', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  const handler = activation.panelHandlers.get('publisher.credentialsChanged')
  activation.getSetting.mockRejectedValueOnce(new Error('private password secret'))

  await expect(
    handler?.(undefined, { panel: { contributionId: 'mqtt-credentials' } })
  ).rejects.toThrow('MQTT publisher refresh failed')
  expect(activation.log.mock.calls.flat().join(' ')).not.toMatch(/private|password|secret/)

  await cleanup()
})

test('shutdown disposes subscriptions and gracefully closes the active client', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)

  await cleanup()
  await cleanup()

  expect(activation.settingsDisposable.dispose).toHaveBeenCalledTimes(1)
  expect(activation.eventDisposable.dispose).toHaveBeenCalledTimes(1)
  for (const disposable of activation.panelDisposables) {
    expect(disposable.dispose).toHaveBeenCalledTimes(1)
  }
  expect(activation.clients[0]?.endCalls).toHaveLength(1)
  expect(activation.clients[0]?.endCalls[0]?.force).toBe(false)
})

test('serializes overlapping settings notifications while replacing clients', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  const firstClient = activation.clients[0]
  if (firstClient === undefined) {
    throw new Error('Initial publisher client was not created')
  }
  firstClient.autoCompleteEnd = false

  activation.values.set('brokerUrl', 'mqtts://latest-broker.example:8883')
  activation.settingsChange()
  activation.values.set('topicPrefix', 'latest-events')
  activation.settingsChange()
  await vi.waitFor(() => expect(firstClient.endCalls).toHaveLength(1))
  expect(firstClient.endCalls).toHaveLength(1)
  expect(mqttConnect).toHaveBeenCalledTimes(1)

  firstClient.endCalls[0]?.callback()
  await vi.waitFor(() => expect(mqttConnect).toHaveBeenCalledTimes(3))

  expect(activation.clients[1]?.endCalls).toHaveLength(1)
  expect(activation.clients[1]?.endCalls[0]?.force).toBe(false)
  expect(mqttConnect).toHaveBeenLastCalledWith('mqtts://latest-broker.example:8883', {
    clientId: 'native-client-id',
    password: 'broker-secret'
  })
  await cleanup()
})

test('failed settings refresh disables publishing and reports only a sanitized error', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  const previousGetCount = activation.getSetting.mock.calls.length
  activation.clients[0]?.emit('connect')
  activation.values.set('brokerUrl', 'password secret prompt')
  activation.getSetting.mockRejectedValueOnce(new Error('password secret prompt output'))
  activation.settingsChange()

  await vi.waitFor(() =>
    expect(activation.getSetting.mock.calls.length).toBeGreaterThan(previousGetCount)
  )
  await vi.waitFor(() =>
    expect(activation.log).toHaveBeenCalledWith('MQTT latest error: mqtt_error')
  )

  activation.event({ workspaceId: null, paneKey: 'pane-secret', state: 'working', receivedAt: 12 })
  expect(activation.clients[0]?.published).toHaveLength(0)
  expect(activation.clients[0]?.endCalls).toHaveLength(1)
  expect(activation.log.mock.calls.flat().join(' ')).not.toMatch(/password|secret|prompt|output/)
  expect(mqttConnect).toHaveBeenCalledTimes(1)
  await cleanup()
})

test('returns a sanitized error when password status cannot be read', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  const handler = activation.panelHandlers.get('publisher.passwordStatus')
  activation.secrets.get.mockRejectedValueOnce(new Error('fixture-only'))

  await expect(
    handler?.(undefined, { panel: { contributionId: 'mqtt-credentials' } })
  ).rejects.toThrow(/^Password status could not be loaded$/)
  await cleanup()
})

test('shutdown skips queued refreshes before they read settings', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  activation.getSetting.mockClear()

  activation.settingsChange()
  await cleanup()

  expect(activation.getSetting).not.toHaveBeenCalled()
  expect(activation.clients).toHaveLength(1)
})

test('shutdown during client close skips reading replacement settings', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  const [client] = activation.clients
  client.autoCompleteEnd = false
  activation.getSetting.mockClear()
  activation.settingsChange()
  await vi.waitFor(() => expect(client.endCalls).toHaveLength(1))

  const closed = cleanup()
  client.endCalls[0].callback()
  await closed

  expect(activation.getSetting).not.toHaveBeenCalled()
  expect(activation.clients).toHaveLength(1)
})

test('shutdown during a secret read prevents a replacement client', async () => {
  const activation = createActivation()
  const cleanup = await activatePublisher(activation.orca)
  let finishRead!: (value: string) => void
  const secretRead = new Promise<string>((resolve) => {
    finishRead = resolve
  })
  activation.secrets.get.mockReturnValueOnce(secretRead)
  activation.settingsChange()
  await vi.waitFor(() => expect(activation.secrets.get).toHaveBeenCalledTimes(2))

  const closed = cleanup()
  finishRead('')
  await closed

  expect(activation.clients).toHaveLength(1)
})
