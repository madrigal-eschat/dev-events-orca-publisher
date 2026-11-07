import type { OrcaWorkerApi } from 'orca/worker'
import { activatePublisher } from './index'

export default function activate(_orca: OrcaWorkerApi): void {
  activatePublisher()
}
