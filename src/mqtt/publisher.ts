import { BlockList, isIPv4 } from 'node:net'
import { hostname, type NetworkInterfaceInfo, networkInterfaces } from 'node:os'
import { connect as mqttConnect } from 'mqtt'
import type { SafePayload } from '../privacy/payload'
import type { EventType, PublisherSettings } from '../settings/settings'
import { buildEnvelope, buildTopic } from './envelope'

export type MqttConnectionOptions = {
  clientId: string
  username?: string
  password?: string
}

export interface MqttClientLike {
  on(event: 'connect' | 'reconnect' | 'close', listener: () => void): this
  on(event: 'error', listener: (error: Error) => void): this
  publish(
    topic: string,
    message: string,
    options: { qos: 0 },
    callback: (error?: Error | null) => void
  ): void
}

export type MqttConnect = (brokerUrl: string, options: MqttConnectionOptions) => MqttClientLike

export type PublisherDiagnostics = {
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error'
  lastError: string | null
}

type PublisherOptions = {
  settings: PublisherSettings
  password?: string
  localIpv4Addresses?: readonly string[]
  hostname?: () => string
  connect?: MqttConnect
  now?: () => Date
  id?: () => string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  return 'MQTT operation failed'
}

function isInHomeSubnet(addresses: readonly string[], subnet: string): boolean {
  if (subnet.length === 0) {
    return true
  }

  const parts = subnet.split('/')
  const prefixLength = Number(parts[1])
  if (
    parts.length !== 2 ||
    parts[0] === undefined ||
    !/^\d+$/.test(parts[1] ?? '') ||
    !Number.isInteger(prefixLength)
  ) {
    throw new TypeError('Invalid home subnet')
  }

  const blockList = new BlockList()
  blockList.addSubnet(parts[0], prefixLength, 'ipv4')
  return addresses.some((address) => isIPv4(address) && blockList.check(address, 'ipv4'))
}

export function getLocalIpv4Addresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string[] {
  return Object.values(interfaces)
    .flat()
    .filter(
      (entry): entry is NetworkInterfaceInfo =>
        entry !== undefined && entry.family === 'IPv4' && !entry.internal
    )
    .map((entry) => entry.address)
}

export class MqttPublisher {
  readonly #settings: PublisherSettings
  readonly #localIpv4Addresses: readonly string[]
  readonly #hostname: () => string
  readonly #now: () => Date
  readonly #id: () => string
  #client: MqttClientLike | undefined
  #diagnostics: PublisherDiagnostics = { connectionState: 'connecting', lastError: null }

  constructor(options: PublisherOptions) {
    this.#settings = options.settings
    this.#localIpv4Addresses = options.localIpv4Addresses ?? getLocalIpv4Addresses()
    this.#hostname = options.hostname ?? hostname
    this.#now = options.now ?? (() => new Date())
    this.#id = options.id ?? (() => globalThis.crypto.randomUUID())

    const connectionOptions: MqttConnectionOptions = { clientId: this.#settings.clientId }
    if (this.#settings.username.length > 0) {
      connectionOptions.username = this.#settings.username
    }
    if (options.password !== undefined && options.password.length > 0) {
      connectionOptions.password = options.password
    }

    try {
      const connect = options.connect ?? ((url, connectOptions) => mqttConnect(url, connectOptions))
      this.#client = connect(this.#settings.brokerUrl, connectionOptions)
      this.#client.on('connect', () => this.#updateDiagnostics('connected', null))
      this.#client.on('reconnect', () => this.#updateDiagnostics('connecting'))
      this.#client.on('close', () => this.#updateDiagnostics('disconnected'))
      this.#client.on('error', (error) => this.#updateDiagnostics('error', errorMessage(error)))
    } catch (error) {
      this.#updateDiagnostics('error', errorMessage(error))
    }
  }

  get diagnostics(): PublisherDiagnostics {
    return { ...this.#diagnostics }
  }

  publishEvent(type: EventType, payload: SafePayload | undefined): void {
    if (
      this.#client === undefined ||
      this.#diagnostics.connectionState !== 'connected' ||
      this.#settings.eventModes[type] === 'OFF' ||
      payload === undefined
    ) {
      return
    }

    let inHomeSubnet: boolean
    try {
      inHomeSubnet = isInHomeSubnet(this.#localIpv4Addresses, this.#settings.homeSubnet)
    } catch (error) {
      this.#updateDiagnostics('error', errorMessage(error))
      return
    }
    if (!inHomeSubnet) {
      return
    }

    const hostLabel = this.#settings.hostLabel || this.#hostname().split('.')[0]
    const envelope = buildEnvelope(
      type,
      payload.data,
      hostLabel,
      payload.subject,
      this.#now(),
      this.#id()
    )
    const topic = buildTopic(this.#settings.topicPrefix, hostLabel, this.#settings.includeHost)

    try {
      this.#client.publish(topic, JSON.stringify(envelope), { qos: 0 }, (error) => {
        if (error) {
          this.#updateDiagnostics('error', errorMessage(error))
        } else {
          this.#updateDiagnostics('connected', null)
        }
      })
    } catch (error) {
      this.#updateDiagnostics('error', errorMessage(error))
    }
  }

  #updateDiagnostics(
    connectionState: PublisherDiagnostics['connectionState'],
    lastError = this.#diagnostics.lastError
  ): void {
    this.#diagnostics = { connectionState, lastError }
  }
}
