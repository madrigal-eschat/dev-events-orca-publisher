import type { OrcaWorkerApi } from 'orca/worker'
import { registerOrcaEventAdapter } from './events/orca-adapter'
import { MqttPublisher } from './mqtt/publisher'
import { getPassword, loadSettings } from './settings/settings'

export async function activatePublisher(orca: OrcaWorkerApi): Promise<void> {
  const settings = await loadSettings(orca.storage)
  const password = await getPassword(orca.secrets)
  const publisher = new MqttPublisher({ settings, password: password ?? undefined })

  registerOrcaEventAdapter(orca, settings, (event) =>
    publisher.publishEvent(event.type, event.payload)
  )
}
