import type { PluginEvents } from 'orca/worker'
import { DeveventsPayload, type SafePayload } from '../privacy/payload'
import type { EventType, PublisherSettings } from '../settings/settings'
import { isRecord } from '../util/is-record'

export type AgentTurnEndReason = 'waiting' | 'interrupted' | 'finished' | 'failed'

export type MappedOrcaEvent = { type: EventType; payload: SafePayload }

function endReason(outcome: unknown): AgentTurnEndReason | undefined {
  switch (outcome) {
    case 'success':
      return 'finished'
    case 'failure':
      return 'failed'
    case 'cancellation':
    case 'interruption':
    case 'superseded':
      return 'interrupted'
    default:
      return undefined
  }
}

export function mapOrcaEvent(
  eventName: string,
  payload: PluginEvents['agent.status.changed'],
  settings: Pick<PublisherSettings, 'eventModes'>
): MappedOrcaEvent | undefined {
  if (eventName !== 'agent.status.changed' || !isRecord(payload)) {
    return undefined
  }

  let type: EventType
  let reason: AgentTurnEndReason | undefined
  switch (payload.state) {
    case 'working':
      type = 'devevents.agent.turn.started'
      break
    case 'blocked':
    case 'waiting':
      type = 'devevents.agent.turn.ended'
      reason = 'waiting'
      break
    case 'done': {
      type = 'devevents.agent.turn.ended'
      const mainAgent = isRecord(payload.mainAgent) ? payload.mainAgent : undefined
      reason = endReason(mainAgent?.outcome)
      if (reason === undefined) {
        return undefined
      }
      break
    }
    default:
      return undefined
  }

  if (settings.eventModes[type] === 'OFF') {
    return undefined
  }

  // FULL and REDACTED are identical: the allowlisted reason is not sensitive.
  const safePayload = new DeveventsPayload()
  if (reason !== undefined) {
    safePayload.addReason(reason)
  }
  return { type, payload: safePayload.toSafePayload(undefined) }
}
