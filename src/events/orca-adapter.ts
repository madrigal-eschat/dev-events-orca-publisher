import type { OrcaWorkerApi } from 'orca/worker'
import type { PublisherSettings } from '../settings/settings'
import { type MappedOrcaEvent, mapOrcaEvent } from './mapping'

export function registerOrcaEventAdapter(
  orca: Pick<OrcaWorkerApi, 'events'>,
  settings: Pick<PublisherSettings, 'eventModes'>,
  onMappedEvent: (event: MappedOrcaEvent) => void
) {
  return orca.events.on('agent.status.changed', (payload) => {
    const mappedEvent = mapOrcaEvent('agent.status.changed', payload, settings)
    if (mappedEvent !== undefined) {
      onMappedEvent(mappedEvent)
    }
  })
}
