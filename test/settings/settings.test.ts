import type { JsonValue, SettingsApi } from 'orca/host'
import { describe, expect, test, vi } from 'vitest'
import {
  allEventsOff,
  createDefaultSettings,
  EVENT_TYPES,
  getPassword,
  loadSettings,
  type PublisherSettings,
  type SecretStore,
  savePassword,
  serializeSettings
} from '../../src/settings/settings'

const DECLARED_SETTING_KEYS = [
  'brokerUrl',
  'username',
  'clientId',
  'topicPrefix',
  'includeHost',
  'hostLabel',
  'homeSubnet',
  'includeProject',
  'agentTurnStartedMode',
  'agentTurnEndedMode'
] as const

class FakeSettings implements Pick<SettingsApi, 'get' | 'set'> {
  readonly values = new Map<string, JsonValue>()
  readonly gets: string[] = []
  readonly sets: Array<[string, JsonValue]> = []

  constructor(initialValues: Record<string, JsonValue> = {}) {
    for (const [key, value] of Object.entries(initialValues)) {
      this.values.set(key, value)
    }
  }

  async get(): Promise<Record<string, JsonValue>>
  async get(key: string): Promise<JsonValue | undefined>
  async get(key?: string): Promise<Record<string, JsonValue> | JsonValue | undefined> {
    if (key === undefined) {
      return Object.fromEntries(this.values)
    }
    this.gets.push(key)
    return this.values.get(key)
  }

  async set(key: string, value: JsonValue): Promise<void> {
    this.sets.push([key, value])
    this.values.set(key, value)
  }
}

function declaredValues(
  overrides: Partial<Record<(typeof DECLARED_SETTING_KEYS)[number], JsonValue>> = {}
): Record<string, JsonValue> {
  return {
    brokerUrl: 'tcp://localhost:1883',
    username: '',
    clientId: 'native-client-id',
    topicPrefix: 'dev-events',
    includeHost: true,
    hostLabel: '',
    homeSubnet: '',
    includeProject: true,
    agentTurnStartedMode: 'OFF',
    agentTurnEndedMode: 'OFF',
    ...overrides
  }
}

describe('publisher settings', () => {
  test('uses the declared defaults and generates a client ID', () => {
    const settings = createDefaultSettings()

    expect(settings.brokerUrl).toBe('tcp://localhost:1883')
    expect(settings.username).toBe('')
    expect(settings.clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(settings.topicPrefix).toBe('dev-events')
    expect(settings.includeHost).toBe(true)
    expect(settings.hostLabel).toBe('')
    expect(settings.homeSubnet).toBe('')
    expect(settings.includeProject).toBe(true)
    expect(Object.values(settings.eventModes).every((mode) => mode === 'OFF')).toBe(true)
  })

  test('maps declared Orca settings to publisher settings', async () => {
    const settingsApi = new FakeSettings(
      declaredValues({
        brokerUrl: 'mqtts://broker.example:8883',
        username: 'publisher',
        clientId: 'saved-client-id',
        topicPrefix: 'private-events',
        includeHost: false,
        hostLabel: 'workstation',
        homeSubnet: '192.168.1.0/24',
        includeProject: false,
        agentTurnStartedMode: 'FULL',
        agentTurnEndedMode: 'REDACTED'
      })
    )

    const settings = await loadSettings(settingsApi)

    expect(settings).toEqual<PublisherSettings>({
      brokerUrl: 'mqtts://broker.example:8883',
      username: 'publisher',
      clientId: 'saved-client-id',
      topicPrefix: 'private-events',
      includeHost: false,
      hostLabel: 'workstation',
      homeSubnet: '192.168.1.0/24',
      includeProject: false,
      eventModes: {
        ...Object.fromEntries(EVENT_TYPES.map((eventType) => [eventType, 'OFF' as const])),
        'devevents.agent.turn.started': 'FULL',
        'devevents.agent.turn.ended': 'REDACTED'
      }
    })
    expect(settings.eventModes['devevents.agent.turn.started']).toBe('FULL')
    expect(settings.eventModes['devevents.agent.turn.ended']).toBe('REDACTED')
    expect(
      EVENT_TYPES.filter(
        (eventType) =>
          eventType !== 'devevents.agent.turn.started' && eventType !== 'devevents.agent.turn.ended'
      ).every((eventType) => settings.eventModes[eventType] === 'OFF')
    ).toBe(true)
    expect(settingsApi.gets).toEqual(DECLARED_SETTING_KEYS)
    expect(settingsApi.sets).toEqual([])
  })

  test('loads native defaults and persists only a generated client ID', async () => {
    const settingsApi = new FakeSettings()
    const createClientId = vi.fn(() => 'generated-client-id')

    const settings = await loadSettings(settingsApi, createClientId)

    expect(settings).toEqual<PublisherSettings>({
      brokerUrl: 'tcp://localhost:1883',
      username: '',
      clientId: 'generated-client-id',
      topicPrefix: 'dev-events',
      includeHost: true,
      hostLabel: '',
      homeSubnet: '',
      includeProject: true,
      eventModes: Object.fromEntries(EVENT_TYPES.map((eventType) => [eventType, 'OFF' as const]))
    })
    expect(settingsApi.sets).toEqual([['clientId', 'generated-client-id']])
  })

  test('strips password fields from serialized settings', () => {
    const settings = { ...createDefaultSettings('client-id'), password: 'fixture-only' }

    expect(JSON.parse(serializeSettings(settings))).toEqual(createDefaultSettings('client-id'))
  })

  test('uses a UUID when no client ID generator is supplied', async () => {
    const settingsApi = new FakeSettings()
    const settings = await loadSettings(settingsApi)

    expect(settings.clientId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(settingsApi.sets).toEqual([['clientId', settings.clientId]])
  })

  test('generates and persists an empty client ID once', async () => {
    const settingsApi = new FakeSettings(declaredValues({ clientId: '' }))
    const createClientId = vi.fn(() => 'stable-client-id')

    const firstLoad = await loadSettings(settingsApi, createClientId)
    const secondLoad = await loadSettings(settingsApi, createClientId)

    expect(firstLoad.clientId).toBe('stable-client-id')
    expect(secondLoad.clientId).toBe('stable-client-id')
    expect(createClientId).toHaveBeenCalledTimes(1)
    expect(settingsApi.sets).toEqual([['clientId', 'stable-client-id']])
  })

  test.each([
    ['brokerUrl', 42],
    ['username', false],
    ['clientId', 3],
    ['topicPrefix', null],
    ['includeHost', 'yes'],
    ['hostLabel', {}],
    ['homeSubnet', 5],
    ['includeProject', 'true']
  ])('rejects invalid value type for %s', async (key, value) => {
    const settingsApi = new FakeSettings(declaredValues({ [key]: value }))

    await expect(loadSettings(settingsApi, () => 'generated')).rejects.toThrow(
      `Invalid publisher setting: ${key}`
    )
  })

  test.each(['ALL', 'redacted', 1])('rejects invalid started event mode %s', async (mode) => {
    const settingsApi = new FakeSettings(declaredValues({ agentTurnStartedMode: mode }))

    await expect(loadSettings(settingsApi, () => 'generated')).rejects.toThrow(
      'Invalid publisher setting: agentTurnStartedMode'
    )
  })

  test.each(['ALL', 'full', true])('rejects invalid ended event mode %s', async (mode) => {
    const settingsApi = new FakeSettings(declaredValues({ agentTurnEndedMode: mode }))

    await expect(loadSettings(settingsApi, () => 'generated')).rejects.toThrow(
      'Invalid publisher setting: agentTurnEndedMode'
    )
  })

  test.each(['tcp://publisher@broker.example:1883', 'tcp://:secret@broker.example:1883'])(
    'rejects broker URLs containing username or password: %s',
    async (brokerUrl) => {
      const settingsApi = new FakeSettings(declaredValues({ brokerUrl }))

      await expect(loadSettings(settingsApi, () => 'generated')).rejects.toThrow(
        'Broker URL must not contain a username or password'
      )
    }
  )

  test('rejects a malformed broker URL', async () => {
    const settingsApi = new FakeSettings(declaredValues({ brokerUrl: 'not a URL' }))

    await expect(loadSettings(settingsApi, () => 'generated')).rejects.toThrow(
      'Invalid publisher setting: brokerUrl'
    )
  })

  test.each(['localhost:1883', 'tcp:localhost:1883'])(
    'rejects broker URLs without a hostname: %s',
    async (brokerUrl) => {
      const settingsApi = new FakeSettings(declaredValues({ brokerUrl }))

      await expect(loadSettings(settingsApi, () => 'generated')).rejects.toThrow(
        'Broker URL must include a hostname'
      )
    }
  )

  test('detects whether every event type is disabled', () => {
    const settings = createDefaultSettings('client-id')

    expect(allEventsOff(settings)).toBe(true)
    settings.eventModes['devevents.agent.turn.started'] = 'FULL'
    expect(allEventsOff(settings)).toBe(false)
  })

  test('stores and retrieves a password only through the secret store', async () => {
    const secrets = new Map<string, string>()
    const store: SecretStore = {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => {
        secrets.set(key, value)
      }
    }

    await savePassword(store, 'secret-value')

    expect(await getPassword(store)).toBe('secret-value')
    expect([...secrets.values()]).toEqual(['secret-value'])
  })
})
