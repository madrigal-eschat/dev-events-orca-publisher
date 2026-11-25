import type { OrcaWorkerApi } from 'orca/worker'
import { activatePublisher } from './index'

let cleanupPublisher: (() => Promise<void>) | undefined

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  cleanupPublisher = await activatePublisher(orca)
}

export async function deactivate(): Promise<void> {
  const cleanup = cleanupPublisher
  cleanupPublisher = undefined
  await cleanup?.()
}
