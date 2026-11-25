import type { OrcaWorkerApi } from 'orca/worker'
import { registerOrcaEventAdapter } from './events/orca-adapter'
import { MqttPublisher } from './mqtt/publisher'
import type { CredentialsChangedResult, PasswordStatusResult } from './panel-contract'
import { createDefaultSettings, getPassword, loadSettings } from './settings/settings'
import { createStatusReporter, warnIfAllEventsOff } from './status'

export async function activatePublisher(orca: OrcaWorkerApi): Promise<() => Promise<void>> {
  const log = (message: string) => orca.log(message)
  const reportStatus = createStatusReporter(log, (update) =>
    orca.host.call('statusBar.update', update)
  )
  let currentSettings = createDefaultSettings('')
  let currentPublisher: MqttPublisher | undefined
  let disposed = false
  let refreshQueue = Promise.resolve()
  const panelRequestSubscriptions: Array<{ dispose(): void }> = []

  const requirePasswordPanel = (contributionId: string): void => {
    if (contributionId !== 'mqtt-credentials') {
      throw new Error('This panel is not allowed to manage MQTT credentials')
    }
  }

  const eventSubscription = registerOrcaEventAdapter(
    orca,
    () => currentSettings,
    (event) => currentPublisher?.publishEvent(event.type, event.payload)
  )

  const refreshPublisher = async (): Promise<void> => {
    if (disposed) {
      return
    }

    const previousPublisher = currentPublisher
    currentPublisher = undefined
    currentSettings = createDefaultSettings('')

    try {
      await previousPublisher?.close()
      if (disposed) {
        return
      }

      const settings = await loadSettings(orca.settings)
      const password = await getPassword(orca.secrets)
      if (disposed) {
        return
      }

      currentSettings = settings
      warnIfAllEventsOff(log, settings)
      currentPublisher = new MqttPublisher({
        settings,
        password: password ?? undefined,
        onDiagnostics: reportStatus
      })
    } catch {
      currentSettings = createDefaultSettings('')
      currentPublisher = undefined
      reportStatus({ connectionState: 'error', lastError: 'mqtt_error' })
      throw new Error('MQTT publisher refresh failed')
    }
  }

  const scheduleRefresh = (): Promise<void> => {
    const refresh = refreshQueue.then(refreshPublisher, refreshPublisher)
    refreshQueue = refresh.catch(() => undefined)
    return refresh
  }

  const settingsSubscription = orca.settings.onDidChange(() => {
    void scheduleRefresh().catch(() => undefined)
  })

  const panels = orca.panels
  if (panels !== undefined) {
    panelRequestSubscriptions.push(
      panels.handle(
        'publisher.passwordStatus',
        async (_input, context): Promise<PasswordStatusResult> => {
          requirePasswordPanel(context.panel.contributionId)
          try {
            return { configured: (await getPassword(orca.secrets)) !== null }
          } catch {
            throw new Error('Password status could not be loaded')
          }
        }
      ),
      panels.handle(
        'publisher.credentialsChanged',
        async (_input, context): Promise<CredentialsChangedResult> => {
          requirePasswordPanel(context.panel.contributionId)
          try {
            await scheduleRefresh()
            return { refreshStarted: true }
          } catch {
            throw new Error('MQTT publisher refresh failed')
          }
        }
      )
    )
  }

  await scheduleRefresh().catch(() => undefined)

  let cleanupPromise: Promise<void> | undefined
  return () => {
    if (cleanupPromise !== undefined) {
      return cleanupPromise
    }

    disposed = true
    eventSubscription.dispose()
    settingsSubscription.dispose()
    for (const subscription of panelRequestSubscriptions) {
      subscription.dispose()
    }
    cleanupPromise = (async () => {
      await refreshQueue
      const publisher = currentPublisher
      currentPublisher = undefined
      await publisher?.close()
    })()
    return cleanupPromise
  }
}
