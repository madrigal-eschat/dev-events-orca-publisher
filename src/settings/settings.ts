import type { SettingsApi } from 'orca/host'

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

export function createDefaultSettings(
  clientId: string = globalThis.crypto.randomUUID()
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

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function invalidSetting(key: string): never {
  throw new TypeError(`Invalid publisher setting: ${key}`)
}

function validateBrokerUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    invalidSetting('brokerUrl')
  }

  if (url.hostname === '') {
    throw new TypeError('Broker URL must include a hostname')
  }

  if (url.username !== '' || url.password !== '') {
    throw new TypeError('Broker URL must not contain a username or password')
  }
}

export async function loadSettings(
  settings: Pick<SettingsApi, 'get' | 'set'>,
  createClientId: () => string = () => globalThis.crypto.randomUUID()
): Promise<PublisherSettings> {
  const defaults = createDefaultSettings('')
  const settingValues = await Promise.all([
    settings.get('brokerUrl'),
    settings.get('username'),
    settings.get('clientId'),
    settings.get('topicPrefix'),
    settings.get('includeHost'),
    settings.get('hostLabel'),
    settings.get('homeSubnet'),
    settings.get('includeProject'),
    settings.get('agentTurnStartedMode'),
    settings.get('agentTurnEndedMode')
  ])
  const [
    brokerUrlValue,
    usernameValue,
    clientIdValue,
    topicPrefixValue,
    includeHostValue,
    hostLabelValue,
    homeSubnetValue,
    includeProjectValue,
    agentTurnStartedModeValue,
    agentTurnEndedModeValue
  ] = settingValues

  const brokerUrl =
    brokerUrlValue === undefined
      ? defaults.brokerUrl
      : isString(brokerUrlValue)
        ? brokerUrlValue
        : invalidSetting('brokerUrl')
  validateBrokerUrl(brokerUrl)
  const username =
    usernameValue === undefined
      ? defaults.username
      : isString(usernameValue)
        ? usernameValue
        : invalidSetting('username')
  let clientId =
    clientIdValue === undefined
      ? defaults.clientId
      : isString(clientIdValue)
        ? clientIdValue
        : invalidSetting('clientId')
  const topicPrefix =
    topicPrefixValue === undefined
      ? defaults.topicPrefix
      : isString(topicPrefixValue)
        ? topicPrefixValue
        : invalidSetting('topicPrefix')
  const includeHost =
    includeHostValue === undefined
      ? defaults.includeHost
      : typeof includeHostValue === 'boolean'
        ? includeHostValue
        : invalidSetting('includeHost')
  const hostLabel =
    hostLabelValue === undefined
      ? defaults.hostLabel
      : isString(hostLabelValue)
        ? hostLabelValue
        : invalidSetting('hostLabel')
  const homeSubnet =
    homeSubnetValue === undefined
      ? defaults.homeSubnet
      : isString(homeSubnetValue)
        ? homeSubnetValue
        : invalidSetting('homeSubnet')
  const includeProject =
    includeProjectValue === undefined
      ? defaults.includeProject
      : typeof includeProjectValue === 'boolean'
        ? includeProjectValue
        : invalidSetting('includeProject')
  const agentTurnStartedMode =
    agentTurnStartedModeValue === undefined
      ? 'OFF'
      : isEventMode(agentTurnStartedModeValue)
        ? agentTurnStartedModeValue
        : invalidSetting('agentTurnStartedMode')
  const agentTurnEndedMode =
    agentTurnEndedModeValue === undefined
      ? 'OFF'
      : isEventMode(agentTurnEndedModeValue)
        ? agentTurnEndedModeValue
        : invalidSetting('agentTurnEndedMode')

  if (clientId === '') {
    clientId = createClientId()
    await settings.set('clientId', clientId)
  }

  const eventModes = { ...defaults.eventModes }
  eventModes['devevents.agent.turn.started'] = agentTurnStartedMode
  eventModes['devevents.agent.turn.ended'] = agentTurnEndedMode

  return {
    brokerUrl,
    username,
    clientId,
    topicPrefix,
    includeHost,
    hostLabel,
    homeSubnet,
    includeProject,
    eventModes
  }
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
