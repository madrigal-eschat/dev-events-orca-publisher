import type { JsonValue, StorageApi } from 'orca/host'
import { describe, expect, test } from 'vitest'
import {
  allEventsOff,
  createDefaultSettings,
  deserializeSettings,
  getPassword,
  loadSettings,
  persistSettings,
  type SecretStore,
  savePassword,
  serializeSettings
} from '../../src/settings/settings'

describe('publisher settings', () => {
  test('uses the JetBrains defaults and generates a client ID', () => {
    const settings = createDefaultSettings()

    expect(settings.brokerUrl).toBe('tcp://localhost:1883')
    expect(settings.username).toBe('')
    expect(settings.clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(settings.topicPrefix).toBe('dev-events')
    expect(settings.includeHost).toBe(true)
    expect(settings.includeProject).toBe(true)
    expect(settings.homeSubnet).toBe('')
    expect(Object.values(settings.eventModes).every((mode) => mode === 'OFF')).toBe(true)
  })

  test('detects whether every event type is disabled', () => {
    const settings = createDefaultSettings('client-id')

    expect(allEventsOff(settings)).toBe(true)
    settings.eventModes['devevents.agent.turn.started'] = 'FULL'
    expect(allEventsOff(settings)).toBe(false)
  })

  test('loads defaults and persists settings through Orca plugin storage', async () => {
    const values = new Map<string, JsonValue>()
    const storage: Pick<StorageApi, 'get' | 'set'> = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        values.set(key, value)
      }
    }

    const defaults = await loadSettings(storage)
    expect(values.get('publisher-settings')).toBe(serializeSettings(defaults))
    const settings = {
      ...defaults,
      brokerUrl: 'mqtts://broker.example:8883',
      username: 'publisher',
      topicPrefix: 'private-events',
      includeHost: false,
      hostLabel: 'workstation',
      homeSubnet: '192.168.1.0/24',
      includeProject: false,
      eventModes: { ...defaults.eventModes, 'devevents.agent.turn.started': 'FULL' as const }
    }
    await persistSettings(storage, settings)

    expect(await loadSettings(storage)).toEqual(settings)
    expect(values.get('publisher-settings')).toBe(serializeSettings(settings))
  })

  test('rejects non-string publisher settings in plugin storage', async () => {
    const storage: Pick<StorageApi, 'get' | 'set'> = {
      get: async () => ({ invalid: true }),
      set: async () => {}
    }

    await expect(loadSettings(storage)).rejects.toThrow('Invalid stored publisher settings')
  })

  test('persists a user-configurable host label and excludes passwords', () => {
    const settings = createDefaultSettings('client-id')
    settings.hostLabel = 'workstation'
    const withUnexpectedPassword = Object.assign({}, settings, { password: 'do-not-persist' })
    const serialized = serializeSettings(withUnexpectedPassword)

    expect(deserializeSettings(serialized)).toEqual(settings)
    expect(serialized).not.toContain('do-not-persist')
    expect(JSON.parse(serialized)).not.toHaveProperty('password')
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
    expect(serializeSettings(createDefaultSettings('client-id'))).not.toContain('secret-value')
  })

  test('rejects malformed or invalid persisted settings', () => {
    const serialized = serializeSettings(createDefaultSettings('client-id'))
    const invalidBroker = JSON.parse(serialized) as Record<string, unknown>
    invalidBroker.brokerUrl = null
    const invalidToggle = JSON.parse(serialized) as Record<string, unknown>
    invalidToggle.includeHost = 'yes'
    const invalidMode = JSON.parse(serialized) as Record<string, unknown>
    const eventModes = invalidMode.eventModes as Record<string, unknown>
    eventModes['devevents.file.saved'] = 'ALL'

    expect(() => deserializeSettings('null')).toThrow('Invalid serialized publisher settings')
    expect(() => deserializeSettings('[]')).toThrow('Invalid serialized publisher settings')
    expect(() => deserializeSettings(JSON.stringify(invalidBroker))).toThrow(
      'Invalid serialized publisher settings'
    )
    expect(() => deserializeSettings(JSON.stringify(invalidToggle))).toThrow(
      'Invalid serialized publisher settings'
    )
    expect(() => deserializeSettings(JSON.stringify(invalidMode))).toThrow(
      'Invalid publisher event mode: devevents.file.saved'
    )
  })

  test('fills missing persisted settings from defaults', () => {
    const settings = deserializeSettings(
      JSON.stringify({ brokerUrl: 'mqtts://broker.example', eventModes: {} })
    )

    expect(settings.brokerUrl).toBe('mqtts://broker.example')
    expect(settings.clientId).not.toBe('')
    expect(settings.username).toBe('')
    expect(settings.includeHost).toBe(true)
    expect(settings.eventModes).toEqual(createDefaultSettings('default-client').eventModes)
  })
})
