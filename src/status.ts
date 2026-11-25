import { allEventsOff, type PublisherSettings } from './settings/settings'
import { isRecord } from './util/is-record'

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

const CONNECTION_FAILURES = new Map<unknown, string>([
  ['ECONNREFUSED', 'connection_refused'],
  ['ECONNRESET', 'connection_reset'],
  ['ENOTFOUND', 'broker_dns_failed'],
  ['EAI_AGAIN', 'broker_dns_failed'],
  ['ETIMEDOUT', 'connection_timeout'],
  ['ENETUNREACH', 'broker_unreachable'],
  ['EHOSTUNREACH', 'broker_unreachable'],
  ['CERT_HAS_EXPIRED', 'broker_tls_validation_failed'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'broker_tls_validation_failed'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'broker_tls_validation_failed'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'broker_tls_validation_failed'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'broker_tls_validation_failed'],
  [4, 'broker_auth_failed'],
  [5, 'broker_auth_failed'],
  [134, 'broker_auth_failed'],
  [135, 'broker_auth_failed']
])

const SAFE_ERRORS = new Set([
  ...CONNECTION_FAILURES.values(),
  'broker_handshake_timeout',
  'connection_failed',
  'publish_failed',
  'invalid_home_subnet',
  'mqtt_error'
])

export function connectionFailure(error: unknown): string {
  if (!isRecord(error)) {
    return 'connection_failed'
  }
  if (error.message === 'connack timeout') {
    return 'broker_handshake_timeout'
  }
  return CONNECTION_FAILURES.get(error.code) ?? 'connection_failed'
}

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
    const enteredError = connectionState === 'error' && previousState !== 'error'

    if (connectionState !== previousState) {
      try {
        log(`MQTT connection state: ${connectionState}`)
      } catch {
        // Diagnostics must not interrupt event handling.
      }
      previousState = connectionState
    }

    if (lastError !== null && (lastError !== previousError || enteredError)) {
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
