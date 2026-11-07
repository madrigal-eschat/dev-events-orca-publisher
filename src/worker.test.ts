import { expect, test } from 'vitest'
import { activatePublisher } from './index'

test('activates the no-op Orca worker scaffold', () => {
  expect(() => activatePublisher()).not.toThrow()
})
