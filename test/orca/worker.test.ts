import type { OrcaWorkerApi } from 'orca/worker'
import { expect, test, vi } from 'vitest'
import { activatePublisher } from '../../src/index'
import activate, { deactivate } from '../../src/worker'

const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../src/index', () => ({ activatePublisher: vi.fn().mockResolvedValue(cleanup) }))

test('passes the Orca worker API to publisher activation', async () => {
  const orca = {} as OrcaWorkerApi

  await activate(orca)

  expect(activatePublisher).toHaveBeenCalledWith(orca)
})

test('deactivation runs the publisher cleanup returned from activation', async () => {
  await activate({} as OrcaWorkerApi)

  await deactivate()

  expect(cleanup).toHaveBeenCalledTimes(1)
})
