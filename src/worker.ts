import type { OrcaWorkerApi } from 'orca/worker'
import { activatePublisher } from './index'

export default function activate(orca: OrcaWorkerApi): Promise<void> {
  return activatePublisher(orca)
}
