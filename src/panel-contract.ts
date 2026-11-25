export type PasswordStatusResult = { configured: boolean }
export type CredentialsChangedResult = { refreshStarted: true }

declare module 'orca' {
  interface PluginRequests {
    'publisher.passwordStatus': {
      output: PasswordStatusResult
    }
    'publisher.credentialsChanged': {
      output: CredentialsChangedResult
    }
  }
}
