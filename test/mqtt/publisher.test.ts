import { connect as mqttConnect } from 'mqtt'
import { describe, expect, test, vi } from 'vitest'
import {
  getLocalIpv4Addresses,
  type MqttClientLike,
  type MqttConnect,
  MqttPublisher
} from '../../src/mqtt/publisher'
import { createDefaultSettings, type EventType } from '../../src/settings/settings'

vi.mock('mqtt', () => ({ connect: vi.fn() }))

class FakeClient implements MqttClientLike {
  readonly published: Array<{
    topic: string
    message: string
    qos: 0
    callback: (error?: Error | null) => void
  }> = []
  readonly listeners: {
    connect: Array<() => void>
    reconnect: Array<() => void>
    close: Array<() => void>
    error: Array<(error: Error) => void>
  } = { connect: [], reconnect: [], close: [], error: [] }
  throwOnPublish: Error | undefined

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

  publish(
    topic: string,
    message: string,
    options: { qos: 0 },
    callback: (error?: Error | null) => void
  ): void {
    if (this.throwOnPublish) {
      throw this.throwOnPublish
    }
    this.published.push({ topic, message, qos: options.qos, callback })
  }

  emit(event: 'connect' | 'reconnect' | 'close'): void {
    for (const listener of this.listeners[event]) {
      listener()
    }
  }

  emitError(error: Error): void {
    for (const listener of this.listeners.error) {
      listener(error)
    }
  }
}

function createPublisher(
  type: EventType,
  options: {
    homeSubnet?: string
    includeHost?: boolean
    connected?: boolean
    username?: string
    localIpv4Addresses?: readonly string[]
    hostLabel?: string
    hostname?: () => string
  } = {}
): { publisher: MqttPublisher; client: FakeClient } {
  const settings = createDefaultSettings('client-id')
  settings.eventModes[type] = 'FULL'
  settings.homeSubnet = options.homeSubnet ?? ''
  settings.includeHost = options.includeHost ?? true
  settings.hostLabel = options.hostLabel ?? 'workstation'
  settings.username = options.username ?? ''

  const client = new FakeClient()
  const connect: MqttConnect = () => client
  const publisher = new MqttPublisher({
    settings,
    password: 'secret',
    localIpv4Addresses: options.localIpv4Addresses ?? ['192.168.1.24'],
    hostname: options.hostname,
    connect,
    now: () => new Date('2026-11-07T16:00:00.000Z'),
    id: () => '550e8400-e29b-41d4-a716-446655440000'
  })
  if (options.connected) {
    client.emit('connect')
  }
  return { publisher, client }
}

describe('asynchronous MQTT publishing', () => {
  test('does not publish while disconnected or when an event is OFF', () => {
    const { publisher, client } = createPublisher('devevents.file.saved')
    publisher.publishEvent('devevents.file.saved', { data: {} })
    client.emit('connect')
    publisher.publishEvent('devevents.file.closed', { data: {} })

    expect(client.published).toHaveLength(0)
  })

  test('publishes enabled messages at QoS 0 to the configured topic without waiting', () => {
    const { publisher, client } = createPublisher('devevents.file.saved', { connected: true })

    expect(
      publisher.publishEvent('devevents.file.saved', {
        data: { file_path: 'src/index.ts' },
        subject: '~/project'
      })
    ).toBeUndefined()
    expect(client.published).toHaveLength(1)
    expect(client.published[0]).toMatchObject({
      topic: 'dev-events/workstation',
      qos: 0
    })
    expect(JSON.parse(client.published[0].message)).toMatchObject({
      type: 'devevents.file.saved',
      source: 'editor/workstation/orca',
      subject: '~/project',
      data: { file_path: 'src/index.ts' }
    })
  })

  test('omits the host from the topic when disabled', () => {
    const { publisher, client } = createPublisher('devevents.file.saved', {
      includeHost: false,
      connected: true
    })
    publisher.publishEvent('devevents.file.saved', { data: {} })

    expect(client.published[0]?.topic).toBe('dev-events')
  })

  test('uses the first machine hostname label when the configured host label is empty', () => {
    const { publisher, client } = createPublisher('devevents.file.saved', {
      connected: true,
      hostLabel: '',
      hostname: () => 'machine-name.example.com'
    })
    publisher.publishEvent('devevents.file.saved', { data: {} })

    expect(client.published[0]?.topic).toBe('dev-events/machine-name')
    expect(JSON.parse(client.published[0]?.message ?? '{}')).toMatchObject({
      source: 'editor/machine-name/orca'
    })
  })

  test('does not publish outside the configured home subnet', () => {
    const { publisher, client } = createPublisher('devevents.file.saved', {
      homeSubnet: '192.168.2.0/24',
      connected: true
    })
    publisher.publishEvent('devevents.file.saved', { data: {} })

    expect(client.published).toHaveLength(0)
  })

  test('publishes when a local address matches the home subnet', () => {
    const { publisher, client } = createPublisher('devevents.file.saved', {
      homeSubnet: '192.168.1.0/24',
      connected: true
    })
    publisher.publishEvent('devevents.file.saved', { data: {} })

    expect(client.published).toHaveLength(1)
  })

  test('allows blank subnet and fails closed with diagnostics for an invalid subnet', () => {
    const allowed = createPublisher('devevents.file.saved', { connected: true })
    allowed.publisher.publishEvent('devevents.file.saved', { data: {} })
    expect(allowed.client.published).toHaveLength(1)

    for (const homeSubnet of ['192.168.1.0/33', 'not-a-cidr']) {
      const rejected = createPublisher('devevents.file.saved', {
        homeSubnet,
        connected: true
      })
      expect(() =>
        rejected.publisher.publishEvent('devevents.file.saved', { data: {} })
      ).not.toThrow()
      expect(rejected.client.published).toHaveLength(0)
      expect(rejected.publisher.diagnostics).toMatchObject({
        connectionState: 'error',
        lastError: expect.any(String)
      })
    }
  })

  test('records connection and publish errors without throwing', () => {
    const { publisher, client } = createPublisher('devevents.file.saved', { connected: true })
    client.emitError(new Error('broker unavailable'))
    expect(publisher.diagnostics).toEqual({
      connectionState: 'error',
      lastError: 'broker unavailable'
    })

    client.emit('connect')
    publisher.publishEvent('devevents.file.saved', { data: {} })
    const publish = client.published[0]
    expect(publish).toBeDefined()
    expect(() => publish?.callback(new Error('publish failed'))).not.toThrow()
    expect(publisher.diagnostics).toEqual({
      connectionState: 'error',
      lastError: 'publish failed'
    })

    client.emit('connect')
    client.published[0]?.callback()
    expect(publisher.diagnostics).toEqual({ connectionState: 'connected', lastError: null })
  })

  test('records synchronous connection and publish failures', () => {
    const settings = createDefaultSettings('client-id')
    const connectionFailure = new MqttPublisher({
      settings,
      localIpv4Addresses: [],
      connect: () => {
        throw null
      }
    })
    expect(connectionFailure.diagnostics).toEqual({
      connectionState: 'error',
      lastError: 'MQTT operation failed'
    })
    expect(() => connectionFailure.publishEvent('devevents.file.saved', { data: {} })).not.toThrow()

    const { publisher, client } = createPublisher('devevents.file.saved', { connected: true })
    client.throwOnPublish = new Error('synchronous publish failed')
    expect(() => publisher.publishEvent('devevents.file.saved', { data: {} })).not.toThrow()
    expect(publisher.diagnostics).toEqual({
      connectionState: 'error',
      lastError: 'synchronous publish failed'
    })
  })

  test('updates diagnostics on connect, reconnect and close', () => {
    const { publisher, client } = createPublisher('devevents.file.saved')

    client.emit('connect')
    expect(publisher.diagnostics.connectionState).toBe('connected')
    client.emit('reconnect')
    expect(publisher.diagnostics.connectionState).toBe('connecting')
    client.emit('close')
    expect(publisher.diagnostics.connectionState).toBe('disconnected')
  })

  test('uses the default mqtt connector and connection settings', () => {
    const settings = createDefaultSettings('client-id')
    settings.username = 'publisher'
    const client = new FakeClient()
    vi.mocked(mqttConnect).mockReturnValue(client as never)

    const publisher = new MqttPublisher({
      settings,
      password: 'secret',
      localIpv4Addresses: []
    })

    expect(mqttConnect).toHaveBeenCalledWith('tcp://localhost:1883', {
      clientId: 'client-id',
      username: 'publisher',
      password: 'secret'
    })
    expect(publisher.diagnostics.connectionState).toBe('connecting')
  })

  test('uses default time, ID and local-address providers', () => {
    const settings = createDefaultSettings('client-id')
    settings.eventModes['devevents.file.saved'] = 'FULL'
    settings.hostLabel = 'workstation'
    const client = new FakeClient()
    const publisher = new MqttPublisher({ settings, connect: () => client })
    client.emit('connect')
    publisher.publishEvent('devevents.file.saved', { data: {} })

    const message = JSON.parse(client.published[0]?.message ?? '{}') as {
      id?: string
      time?: string
    }
    expect(message.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(message.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  })

  test('collects only external IPv4 addresses', () => {
    const addresses = getLocalIpv4Addresses({
      en0: [
        { address: '192.168.1.24', family: 'IPv4', internal: false },
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: 'fe80::1', family: 'IPv6', internal: false }
      ],
      empty: undefined
    })

    expect(addresses).toEqual(['192.168.1.24'])
  })
})
