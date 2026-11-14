import type { OrcaWorkerApi } from 'orca/worker'
import { expect, test, vi } from 'vitest'
import { activatePublisher } from './index'
import activate from './worker'

vi.mock('./index', () => ({ activatePublisher: vi.fn().mockResolvedValue(undefined) }))

test('passes the Orca worker API to publisher activation', async () => {
  const orca = {} as OrcaWorkerApi

  await activate(orca)

  expect(activatePublisher).toHaveBeenCalledWith(orca)
})
