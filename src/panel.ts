import type { PanelContext } from 'orca'
import {
  atom,
  Button,
  Heading,
  h,
  host,
  Input,
  plugin,
  read,
  Stack,
  secrets,
  set,
  Text
} from 'orca'
import type { PasswordStatusResult } from './panel-contract'

const password = atom('')
const configured = atom<boolean | null>(null)
const secureStorageAvailable = atom<boolean | null>(null)
const errorMessage = atom('')
const saving = atom(false)

const PROTECTION_ERROR = 'Secure storage is unavailable. Password saving is disabled.'

async function loadPanelState(signal: AbortSignal): Promise<void> {
  try {
    const protection = await host.call('secrets.protection')
    if (signal.aborted) {
      return
    }
    const available = protection.status === 'os-keyring'
    set(secureStorageAvailable, available)
    if (!available) {
      set(errorMessage, PROTECTION_ERROR)
    }
  } catch {
    if (signal.aborted) {
      return
    }
    set(secureStorageAvailable, false)
    set(errorMessage, 'Secure storage could not be verified. Password saving is disabled.')
  }

  try {
    const status: PasswordStatusResult = await plugin.request('publisher.passwordStatus')
    if (!signal.aborted) {
      set(configured, status.configured)
    }
  } catch {
    if (!signal.aborted) {
      set(errorMessage, 'Password configuration status could not be loaded.')
    }
  }
}

async function savePassword(): Promise<void> {
  const value = read(password)
  if (value.length === 0 || read(saving)) {
    return
  }

  set(errorMessage, '')
  set(saving, true)
  try {
    const protection = await host.call('secrets.protection')
    if (protection.status !== 'os-keyring') {
      set(secureStorageAvailable, false)
      set(errorMessage, PROTECTION_ERROR)
      return
    }
    set(secureStorageAvailable, true)

    await secrets.set('broker-password', value)
    set(password, '')
    set(configured, true)

    try {
      await plugin.request('publisher.credentialsChanged')
    } catch {
      set(errorMessage, 'Password saved, but the publisher refresh could not be started.')
    }
  } catch {
    set(errorMessage, 'Password could not be saved. Check Orca secret storage and try again.')
  } finally {
    set(saving, false)
  }
}

async function clearPassword(): Promise<void> {
  if (read(saving)) {
    return
  }

  set(errorMessage, '')
  set(saving, true)
  try {
    await secrets.delete('broker-password')
    set(configured, false)
    try {
      await plugin.request('publisher.credentialsChanged')
    } catch {
      set(errorMessage, 'Password cleared, but the publisher refresh could not be started.')
    }
  } catch {
    set(errorMessage, 'Password could not be cleared. Check Orca secret storage and try again.')
  } finally {
    set(saving, false)
  }
}

export function setup(context: PanelContext): () => void {
  const clearPassword = () => set(password, '')
  context.signal.addEventListener('abort', clearPassword, { once: true })
  void loadPanelState(context.signal)
  return () => {
    context.signal.removeEventListener('abort', clearPassword)
    clearPassword()
  }
}

export default function PasswordPanel() {
  const isConfigured = read(configured)
  const secureAvailable = read(secureStorageAvailable)
  const canSave = secureAvailable === true
  const isSaving = read(saving)
  const statusText =
    isConfigured === null
      ? 'Password configuration status is unavailable.'
      : isConfigured
        ? 'Password is configured.'
        : 'No password is configured.'
  const warningText =
    secureAvailable === null ? 'Checking secure storage…' : secureAvailable ? '' : PROTECTION_ERROR
  const message = read(errorMessage)

  return h(
    Stack,
    { gap: 'md' },
    h(Heading, { level: 2 }, 'MQTT password'),
    h(Text, {}, statusText),
    warningText === '' ? null : h(Text, { tone: 'warning' }, warningText),
    h(Input, {
      label: 'MQTT password',
      type: 'password',
      value: read(password),
      disabled: isSaving,
      onChange: (value: string) => set(password, value)
    }),
    h(
      Stack,
      { gap: 'sm' },
      h(
        Button,
        {
          disabled: isSaving || !canSave || read(password).length === 0,
          onPress: () => void savePassword()
        },
        'Save password'
      ),
      h(
        Button,
        {
          disabled: isSaving || isConfigured !== true,
          variant: 'outline',
          onPress: () => void clearPassword()
        },
        'Clear password'
      )
    ),
    message === '' ? null : h(Text, { tone: 'danger' }, message)
  )
}
