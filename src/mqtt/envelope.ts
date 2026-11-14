import type { SafePayload } from '../privacy/payload'
import { EVENT_TYPES, type EventType } from '../settings/settings'

export type CloudEvent = {
  specversion: '1.0'
  id: string
  type: EventType
  source: string
  sourcetype: 'editor'
  subject?: string
  time: string
  data: Record<string, string | number>
}

export function buildEnvelope(
  type: EventType,
  data: SafePayload['data'],
  hostLabel: string,
  subject?: string,
  now: Date = new Date(),
  id: string = globalThis.crypto.randomUUID()
): CloudEvent {
  if (!EVENT_TYPES.includes(type)) {
    throw new TypeError(`Unsupported dev-events type: ${type}`)
  }

  const event: CloudEvent = {
    specversion: '1.0',
    id,
    type,
    source: `editor/${hostLabel}/orca`,
    sourcetype: 'editor',
    time: now.toISOString(),
    data
  }
  if (typeof subject === 'string' && subject.length > 0) {
    event.subject = subject
  }
  return event
}

export function buildTopic(topicPrefix: string, hostLabel: string, includeHost: boolean): string {
  return includeHost ? `${topicPrefix}/${hostLabel}` : topicPrefix
}
