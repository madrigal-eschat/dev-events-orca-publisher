import type { StorageApi } from 'orca/host'
import { isRecord } from '../util/is-record'

export const EVENT_TYPES = [
  'devevents.task.started',
  'devevents.task.succeeded',
  'devevents.task.failed',
  'devevents.test.started',
  'devevents.test.succeeded',
  'devevents.test.failed',
  'devevents.file.saved',
  'devevents.file.opened',
  'devevents.file.closed',
  'devevents.breakpoint.hit',
  'devevents.vcs.committed',
  'devevents.vcs.pushed',
  'devevents.vcs.branch.changed',
  'devevents.editor.focus.gained',
  'devevents.editor.focus.lost',
  'devevents.keypresses',
  'devevents.agent.started',
  'devevents.agent.turn.started',
  'devevents.agent.turn.ended',
  'devevents.agent.exited'
] as const

export type EventType = (typeof EVENT_TYPES)[number]
export type EventMode = 'OFF' | 'REDACTED' | 'FULL'

export type PublisherSettings = {
  brokerUrl: string
  username: string
  clientId: string
  topicPrefix: string
  includeHost: boolean
  hostLabel: string
  homeSubnet: string
  includeProject: boolean
  eventModes: Record<EventType, EventMode>
}

export type SecretStore = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

const PASSWORD_SECRET_KEY = 'broker-password'
const SETTINGS_STORAGE_KEY = 'publisher-settings'

export function createDefaultSettings(
  clientId = globalThis.crypto.randomUUID()
): PublisherSettings {
  const eventModes = {} as Record<EventType, EventMode>
  for (const eventType of EVENT_TYPES) {
    eventModes[eventType] = 'OFF'
  }

  return {
    brokerUrl: 'tcp://localhost:1883',
    username: '',
    clientId,
    topicPrefix: 'dev-events',
    includeHost: true,
    hostLabel: '',
    homeSubnet: '',
    includeProject: true,
    eventModes
  }
}

export function serializeSettings(settings: PublisherSettings): string {
  return JSON.stringify(settings, (key, value: unknown) => (key === 'password' ? undefined : value))
}

function isEventMode(value: unknown): value is EventMode {
  return value === 'OFF' || value === 'REDACTED' || value === 'FULL'
}

function isEventModes(value: unknown): value is Record<EventType, EventMode> {
  return isRecord(value) && EVENT_TYPES.every((eventType) => isEventMode(value[eventType]))
}

function isPublisherSettings(value: unknown): value is PublisherSettings {
  return (
    isRecord(value) &&
    typeof value.brokerUrl === 'string' &&
    typeof value.username === 'string' &&
    typeof value.clientId === 'string' &&
    typeof value.topicPrefix === 'string' &&
    typeof value.includeHost === 'boolean' &&
    typeof value.hostLabel === 'string' &&
    typeof value.homeSubnet === 'string' &&
    typeof value.includeProject === 'boolean' &&
    isEventModes(value.eventModes)
  )
}

export function deserializeSettings(serialized: string): PublisherSettings {
  const storedValue: unknown = JSON.parse(serialized)
  if (
    !isRecord(storedValue) ||
    (storedValue.eventModes !== undefined && !isRecord(storedValue.eventModes))
  ) {
    throw new TypeError('Invalid serialized publisher settings')
  }

  const defaults = createDefaultSettings()
  const value = {
    ...defaults,
    ...storedValue,
    eventModes: { ...defaults.eventModes, ...storedValue.eventModes }
  }

  for (const eventType of EVENT_TYPES) {
    const mode = value.eventModes[eventType]
    if (!isEventMode(mode)) {
      throw new TypeError(`Invalid publisher event mode: ${eventType}`)
    }
  }

  if (!isPublisherSettings(value)) {
    throw new TypeError('Invalid serialized publisher settings')
  }

  return value
}

export async function loadSettings(
  storage: Pick<StorageApi, 'get' | 'set'>
): Promise<PublisherSettings> {
  const storedSettings = await storage.get(SETTINGS_STORAGE_KEY)
  if (storedSettings === null) {
    const defaults = createDefaultSettings()
    await storage.set(SETTINGS_STORAGE_KEY, serializeSettings(defaults))
    return defaults
  }
  if (typeof storedSettings !== 'string') {
    throw new TypeError('Invalid stored publisher settings')
  }
  return deserializeSettings(storedSettings)
}

export function persistSettings(
  storage: Pick<StorageApi, 'set'>,
  settings: PublisherSettings
): Promise<void> {
  return storage.set(SETTINGS_STORAGE_KEY, serializeSettings(settings))
}

export function savePassword(secrets: SecretStore, password: string): Promise<void> {
  return secrets.set(PASSWORD_SECRET_KEY, password)
}

export function getPassword(secrets: SecretStore): Promise<string | null> {
  return secrets.get(PASSWORD_SECRET_KEY)
}

export function allEventsOff(settings: Pick<PublisherSettings, 'eventModes'>): boolean {
  return EVENT_TYPES.every((eventType) => settings.eventModes[eventType] === 'OFF')
}
