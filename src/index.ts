import type { OrcaWorkerApi } from 'orca/worker'
import { registerOrcaEventAdapter } from './events/orca-adapter'
import { MqttPublisher } from './mqtt/publisher'
import { getPassword, loadSettings } from './settings/settings'
import { createStatusReporter, warnIfAllEventsOff } from './status'

export async function activatePublisher(orca: OrcaWorkerApi): Promise<void> {
  const settings = await loadSettings(orca.storage)
  const log = (message: string) => orca.log(message)
  warnIfAllEventsOff(log, settings)
  const reportStatus = createStatusReporter(log, (update) =>
    orca.host.call('statusBar.update', update)
  )
  const password = await getPassword(orca.secrets)
  const publisher = new MqttPublisher({
    settings,
    password: password ?? undefined,
    onDiagnostics: reportStatus
  })

  registerOrcaEventAdapter(orca, settings, (event) =>
    publisher.publishEvent(event.type, event.payload)
  )
}
