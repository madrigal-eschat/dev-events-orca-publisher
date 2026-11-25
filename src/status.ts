import { allEventsOff, type PublisherSettings } from './settings/settings'

export type DiagnosticSnapshot = {
  connectionState: 'connecting' | 'connected' | 'disconnected' | 'error'
  lastError: string | null
}

type StatusBarUpdate = {
  id: 'mqtt-status'
  text: string
  icon: 'plug'
  tone: 'neutral' | 'success' | 'warning' | 'danger'
  tooltip: string
}

type StatusBarUpdater = (update: StatusBarUpdate) => undefined | Promise<unknown>

const SAFE_ERRORS = new Set([
  'connection_failed',
  'publish_failed',
  'invalid_home_subnet',
  'mqtt_error'
])

function safeState(value: string): DiagnosticSnapshot['connectionState'] {
  switch (value) {
    case 'connecting':
    case 'connected':
    case 'disconnected':
    case 'error':
      return value
    default:
      return 'error'
  }
}

function safeError(value: string | null): string | null {
  if (value === null) {
    return null
  }
  return SAFE_ERRORS.has(value) ? value : 'mqtt_error'
}

function statusBarUpdate(
  connectionState: DiagnosticSnapshot['connectionState'],
  lastError: string | null
): StatusBarUpdate {
  const text = `MQTT: ${connectionState.charAt(0).toUpperCase()}${connectionState.slice(1)}`
  const tone =
    connectionState === 'connected'
      ? 'success'
      : connectionState === 'error'
        ? 'danger'
        : connectionState === 'disconnected'
          ? 'warning'
          : 'neutral'
  const errorText = lastError === null ? '' : `; latest error: ${lastError}`
  return {
    id: 'mqtt-status',
    text,
    icon: 'plug',
    tone,
    tooltip: `MQTT connection state: ${connectionState}${errorText}`
  }
}

export function createStatusReporter(
  log: (message: string) => void,
  updateStatusBar: StatusBarUpdater
): (diagnostics: DiagnosticSnapshot) => void {
  let previousState: DiagnosticSnapshot['connectionState'] | undefined
  let previousError: string | null = null

  return (diagnostics) => {
    const connectionState = safeState(diagnostics.connectionState)
    const lastError = safeError(diagnostics.lastError)

    if (connectionState !== previousState) {
      try {
        log(`MQTT connection state: ${connectionState}`)
      } catch {
        // Diagnostics must not interrupt event handling.
      }
      previousState = connectionState
    }

    if (lastError !== null && lastError !== previousError) {
      try {
        log(`MQTT latest error: ${lastError}`)
      } catch {
        // Diagnostics must not interrupt event handling.
      }
    }
    previousError = lastError

    try {
      const update = updateStatusBar(statusBarUpdate(connectionState, lastError))
      if (update instanceof Promise) {
        void update.catch(() => {})
      }
    } catch {
      // Status UI availability must not affect publishing.
    }
  }
}

export function warnIfAllEventsOff(
  log: (message: string) => void,
  settings: Pick<PublisherSettings, 'eventModes'>
): void {
  if (allEventsOff(settings)) {
    log('All publisher events are disabled')
  }
}
