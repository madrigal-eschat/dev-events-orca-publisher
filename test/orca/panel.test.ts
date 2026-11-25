import type { PanelContext } from 'orca'
import { assert, hostError, mockHost, mount, mountWorker } from 'orca/testing'
import { test, vi } from 'vitest'
import * as panelModule from '../../src/panel'
import * as workerModule from '../../src/worker'

const PASSWORD = 'panel-only-secret'
const RAW_ERROR = 'secret store internals containing panel-only-secret'

function visibleText(panel: Awaited<ReturnType<typeof mount>>): string {
  return panel
    .findAll({ type: 'Text' })
    .map((element) => element.text)
    .join(' ')
}

vi.mock('mqtt', () => ({
  connect: () => ({
    on() {
      return this
    },
    publish() {},
    end(_force: boolean, callback: () => void) {
      callback()
      return this
    }
  })
}))

test('reports password configuration without rendering the stored password', async () => {
  const host = mockHost({
    secrets: { 'broker-password': PASSWORD },
    requests: { 'publisher.passwordStatus': { configured: true } }
  })
  const panel = await mount(panelModule, { host })

  assert.match(JSON.stringify(panel.tree()), /Password is configured/)
  assert.equal(JSON.stringify(panel.tree()).includes(PASSWORD), false)
  assert.equal(host.callsOf('secrets.get').length, 0)
  await panel.unmount()
})

test('saves the password, clears the input, and requests a password-free refresh', async () => {
  const host = mockHost({
    requests: {
      'publisher.passwordStatus': { configured: false },
      'publisher.credentialsChanged': { refreshStarted: true }
    }
  })
  const panel = await mount(panelModule, { host })
  const input = panel.find({ type: 'Input' })

  assert.ok(input)
  await panel.type(input, PASSWORD, { replace: true })
  await panel.press({ type: 'Button', text: 'Save password' })

  const savedInput = panel.find({ type: 'Input' })
  assert.ok(savedInput)
  assert.equal(host.data().secrets['broker-password'], PASSWORD)
  assert.equal(panel.valueOf(savedInput), '')
  assert.equal(host.callsOf('secrets.set').length, 1)
  assert.equal(host.callsOf('plugin.request').length, 2)
  assert.equal(JSON.stringify(host.callsOf('plugin.request')).includes(PASSWORD), false)
  assert.equal(JSON.stringify(panel.tree()).includes(PASSWORD), false)
  await panel.unmount()
})

test('clears the entered password when the panel is unmounted and reopened', async () => {
  const host = mockHost({
    requests: { 'publisher.passwordStatus': { configured: false } }
  })
  let teardownCleanupCalled = false
  let signalAborted = false
  const moduleWithObservedCleanup = {
    default: panelModule.default,
    setup(context: PanelContext) {
      context.signal.addEventListener('abort', () => {
        signalAborted = true
      })
      const cleanup = panelModule.setup?.(context)
      if (typeof cleanup !== 'function') {
        return
      }
      return () => {
        teardownCleanupCalled = true
        cleanup()
      }
    }
  }
  const firstPanel = await mount(moduleWithObservedCleanup, { host })
  const firstInput = firstPanel.find({ type: 'Input' })

  assert.ok(firstInput)
  await firstPanel.type(firstInput, PASSWORD, { replace: true })
  const enteredInput = firstPanel.find({ type: 'Input' })
  assert.ok(enteredInput)
  assert.equal(firstPanel.valueOf(enteredInput), PASSWORD)
  await firstPanel.unmount()
  assert.equal(signalAborted, true)
  assert.equal(teardownCleanupCalled, true)

  const reopenedPanel = await mount(panelModule, { host })
  const reopenedInput = reopenedPanel.find({ type: 'Input' })

  assert.ok(reopenedInput)
  assert.equal(reopenedPanel.valueOf(reopenedInput), '')
  await reopenedPanel.unmount()
})

test('clears the stored password and requests a password-free refresh', async () => {
  const host = mockHost({
    secrets: { 'broker-password': PASSWORD },
    requests: {
      'publisher.passwordStatus': { configured: true },
      'publisher.credentialsChanged': { refreshStarted: true }
    }
  })
  const panel = await mount(panelModule, { host })

  await panel.press({ type: 'Button', text: 'Clear password' })

  assert.equal(host.data().secrets['broker-password'], undefined)
  assert.equal(host.callsOf('secrets.delete').length, 1)
  assert.equal(host.callsOf('plugin.request').length, 2)
  assert.equal(JSON.stringify(host.callsOf('plugin.request')).includes(PASSWORD), false)
  await panel.unmount()
})

test('does not save when secret protection is unavailable', async () => {
  const host = mockHost({
    results: { 'secrets.protection': { status: 'unavailable' } },
    requests: { 'publisher.passwordStatus': { configured: false } }
  })
  const panel = await mount(panelModule, { host })
  const input = panel.find({ type: 'Input' })

  assert.ok(input)
  await panel.type(input, PASSWORD, { replace: true })

  assert.equal(host.callsOf('secrets.set').length, 0)
  assert.equal(panel.find({ type: 'Button', text: 'Save password' })?.disabled, true)
  assert.equal(visibleText(panel).includes(PASSWORD), false)
  assert.match(visibleText(panel), /secure storage is unavailable/i)
  await panel.unmount()
})

test('shows only a safe error after secret-store writes or worker refresh fail', async () => {
  const writeHost = mockHost({
    results: {
      'secrets.set': () => {
        throw hostError('action_failed', RAW_ERROR)
      }
    },
    requests: { 'publisher.passwordStatus': { configured: false } }
  })
  const writePanel = await mount(panelModule, { host: writeHost })
  const input = writePanel.find({ type: 'Input' })

  assert.ok(input)
  await writePanel.type(input, PASSWORD, { replace: true })
  await writePanel.press({ type: 'Button', text: 'Save password' })
  assert.equal(visibleText(writePanel).includes(PASSWORD), false)
  assert.equal(visibleText(writePanel).includes(RAW_ERROR), false)
  assert.match(visibleText(writePanel), /password could not be saved/i)
  const failedInput = writePanel.find({ type: 'Input' })
  assert.ok(failedInput)
  assert.equal(writePanel.valueOf(failedInput), PASSWORD)
  assert.equal(JSON.stringify(writeHost.callsOf('plugin.request')).includes(PASSWORD), false)
  await writePanel.unmount()

  const refreshHost = mockHost({
    requests: {
      'publisher.passwordStatus': { configured: false },
      'publisher.credentialsChanged': () => {
        throw hostError('action_failed', RAW_ERROR)
      }
    }
  })
  const refreshPanel = await mount(panelModule, { host: refreshHost })
  const refreshInput = refreshPanel.find({ type: 'Input' })

  assert.ok(refreshInput)
  await refreshPanel.type(refreshInput, PASSWORD, { replace: true })
  await refreshPanel.press({ type: 'Button', text: 'Save password' })
  assert.equal(visibleText(refreshPanel).includes(PASSWORD), false)
  assert.equal(visibleText(refreshPanel).includes(RAW_ERROR), false)
  assert.match(visibleText(refreshPanel), /publisher refresh could not be started/i)
  assert.equal(JSON.stringify(refreshHost.callsOf('plugin.request')).includes(PASSWORD), false)
  await refreshPanel.unmount()
})

test('worker password requests expose only a configured flag or refresh-started result', async () => {
  const worker = await mountWorker(workerModule, {
    host: mockHost({ secrets: { 'broker-password': PASSWORD } })
  })

  assert.deepEqual(
    await worker.request('publisher.passwordStatus', undefined, {
      panel: 'mqtt-credentials'
    }),
    { configured: true }
  )
  assert.deepEqual(
    await worker.request('publisher.credentialsChanged', undefined, {
      panel: 'mqtt-credentials'
    }),
    { refreshStarted: true }
  )
  assert.equal(JSON.stringify(worker.posts).includes(PASSWORD), false)
  await worker.deactivate()
})

test('worker password requests reject callers from other contributions', async () => {
  const worker = await mountWorker(workerModule)

  await assert.rejects(
    worker.request('publisher.passwordStatus', undefined, { panel: 'another-panel' })
  )
  await assert.rejects(
    worker.request('publisher.credentialsChanged', undefined, { panel: 'another-panel' })
  )
  await worker.deactivate()
})
