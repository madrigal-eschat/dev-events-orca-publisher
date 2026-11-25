# Orca Publisher Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make broker and event preferences user-editable in Orca while managing the MQTT password only through Orca's encrypted secret store.

**Architecture:** Declare non-secret scalar settings in the plugin manifest and map Orca's `settings` API into the existing typed `PublisherSettings`. Keep one event adapter registered, but have it read the latest settings; serialize publisher replacement and gracefully close the previous MQTT client when settings or credentials change. Add one Orca components panel that saves/clears the password through `secrets:own` and requests a password-free worker refresh.

**Tech Stack:** TypeScript, Orca manifest v2 and worker/frame APIs, Orca components panels and `orca/testing`, MQTT.js, Vitest.

---

### Task 1: Expose native settings and map them to publisher settings

**Files:**
- Modify: `orca-plugin.json`
- Modify: `src/settings/settings.ts`
- Modify: `test/settings/settings.test.ts`

- [x] **Step 1: Add failing settings API tests**

Replace storage-backed test fixtures with a fake `SettingsApi` backed by a `Map`. Cover:

```ts
test('maps declared Orca settings and only enables the two supported event modes', async () => {
  const api = makeSettingsApi({
    brokerUrl: 'tcp://broker.example:1883',
    username: 'publisher',
    clientId: 'stable-id',
    topicPrefix: 'private-events',
    includeHost: false,
    hostLabel: 'workstation',
    homeSubnet: '192.168.1.0/24',
    includeProject: false,
    agentTurnStartedMode: 'FULL',
    agentTurnEndedMode: 'REDACTED'
  })

  const settings = await loadSettings(api)

  expect(settings.clientId).toBe('stable-id')
  expect(settings.eventModes['devevents.agent.turn.started']).toBe('FULL')
  expect(settings.eventModes['devevents.agent.turn.ended']).toBe('REDACTED')
  expect(
    Object.entries(settings.eventModes)
      .filter(([type]) => !type.startsWith('devevents.agent.turn.'))
      .every(([, mode]) => mode === 'OFF')
  ).toBe(true)
})
```

Also test the declared defaults, invalid value types/modes, rejection of a broker URL containing username or password, and that loading/persisting settings uses only the Orca settings API. Inject a deterministic client-ID factory and assert an empty `clientId` is generated once and saved through `settings.set`; loading the saved value again must preserve it.

- [x] **Step 2: Run the settings tests and verify they fail**

Run: `npm test -- test/settings/settings.test.ts`

Expected: FAIL because the current loader expects `StorageApi`, the manifest has no declared settings, and values are stored as one serialized JSON object.

- [x] **Step 3: Declare the Orca settings**

In `orca-plugin.json`, replace `storage:own` with `settings:own` and add `contributes.settings` entries for:

| Key | Type | Default | Other control |
| --- | --- | --- | --- |
| `brokerUrl` | string | `tcp://localhost:1883` | Reject embedded URL user-info in the settings mapper |
| `username` | string | empty | — |
| `clientId` | string | empty | Empty value is generated and persisted by the worker |
| `topicPrefix` | string | `dev-events` | — |
| `includeHost` | boolean | `true` | — |
| `hostLabel` | string | empty | — |
| `homeSubnet` | string | empty | — |
| `includeProject` | boolean | `true` | — |
| `agentTurnStartedMode` | string | `OFF` | enum `OFF`, `REDACTED`, `FULL` |
| `agentTurnEndedMode` | string | `OFF` | enum `OFF`, `REDACTED`, `FULL` |

Do not declare settings for unsupported event types, and do not add a password setting. Keep `secrets:own`, `agent:read`, `trusted-worker`, the existing event contribution, and the Orca minimum version.

- [x] **Step 4: Implement Settings API mapping**

In `src/settings/settings.ts`, change `loadSettings` to accept Orca's `SettingsApi` (or its `get`/`set` subset), map the declared keys into `PublisherSettings`, and initialize every unsupported `EVENT_TYPES` entry to `OFF`. Preserve current defaults. If `clientId` is empty, generate a UUID, persist it with `settings.set('clientId', value)`, and use that value. Reject invalid runtime values and broker URLs containing URL username/password; do not silently substitute defaults for malformed values.

Remove `SETTINGS_STORAGE_KEY`, `serializeSettings`, `deserializeSettings`, and `persistSettings` if no other code uses them. Retain `SecretStore`, `getPassword`, and `savePassword` only if they remain used by the worker or panel tests.

- [x] **Step 5: Run settings tests and commit**

Run: `npm test -- test/settings/settings.test.ts`

Expected: PASS for defaults, exact key mapping, unsupported-event OFF behavior, stable client ID persistence, invalid values, and URL user-info rejection.

Commit with `feat: expose publisher settings`.

### Task 2: Reconfigure the worker and gracefully replace MQTT clients

**Files:**
- Modify: `src/index.ts`
- Modify: `src/worker.ts`
- Modify: `src/events/orca-adapter.ts`
- Modify: `src/mqtt/publisher.ts`
- Modify: `test/events/orca-adapter.test.ts`
- Modify: `test/mqtt/publisher.test.ts`
- Modify: `src/worker.test.ts`
- Create: `src/index.test.ts`

- [x] **Step 1: Add failing adapter and publisher lifecycle tests**

Change adapter tests to pass a settings getter and verify that one registered `agent.status.changed` callback observes changed event modes without a second subscription. Extend the fake MQTT client with a graceful `end(false, callback)` operation. Test that closing a publisher ends its client and that a closed publisher sends no later events.

Add activation tests for initial settings/password loading, a settings change replacing the publisher, the previous client being gracefully closed, event subscription remaining registered once, and shutdown disposing subscriptions and closing the active client.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- test/events/orca-adapter.test.ts test/mqtt/publisher.test.ts src/index.test.ts src/worker.test.ts`

Expected: FAIL because the adapter captures stale settings, the publisher has no close operation, and activation currently reads `orca.storage` only once.

- [x] **Step 3: Make the event adapter read current settings**

Update `registerOrcaEventAdapter` to accept a `() => Pick<PublisherSettings, 'eventModes'>` getter. Read it inside the event callback before calling `mapOrcaEvent`; keep the current single subscription and return its disposable.

- [x] **Step 4: Add graceful publisher disposal**

Extend `MqttClientLike` with the MQTT.js graceful end signature and add an idempotent async `MqttPublisher.close()` method. It must stop future publishes and wait for `client.end(false, callback)` to complete. Keep MQTT diagnostics sanitized and preserve QoS 0 publishing behavior.

- [x] **Step 5: Reconfigure activation from current Orca settings**

In `src/index.ts`, load from `orca.settings`, load the password directly from `orca.secrets`, and keep `currentSettings` plus the current publisher in the activation closure. Register the event adapter once with `() => currentSettings`. Subscribe to `orca.settings.onDidChange` and serialize refreshes so overlapping notifications cannot leave multiple clients active. Each refresh must close the old client, reload settings and secret, then create the replacement. If loading fails, leave publishing disabled and report a safe sanitized error through the existing status reporter; do not resume with stale settings.

Return an async cleanup function from `activatePublisher`. In `src/worker.ts`, retain it and export Orca's optional `deactivate()` that disposes the settings/event subscriptions and closes the active publisher. Task 3 adds the panel request subscriptions to the same cleanup path.

- [x] **Step 6: Run focused worker tests and commit**

Run: `npm test -- test/events/orca-adapter.test.ts test/mqtt/publisher.test.ts src/index.test.ts src/worker.test.ts`

Expected: PASS; settings changes update mode filtering immediately, replace one MQTT client gracefully, and worker shutdown leaves no active client or subscriptions.

Commit with `feat: reconfigure publisher from Orca settings`.

### Task 3: Add the secure password panel and worker requests

**Files:**
- Modify: `orca-plugin.json`
- Modify: `src/index.test.ts`
- Modify: `vitest.config.ts`
- Create: `src/panel-contract.ts`
- Create: `src/panel.ts`
- Create: `src/panel.test.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Add failing panel and request tests**

Use `mount` and `mockHost` from `orca/testing` to cover:

- The panel reports only whether a password is configured; it never renders a stored password.
- Save calls `secrets.set`, clears the input after success, and calls the worker refresh request with no password value.
- Clear calls `secrets.delete` and then the same password-free worker request.
- Secret-store protection or write failures and worker refresh failures produce safe visible errors.
- Neither the password value nor a raw secret-store error is included in visible text or worker requests.

Extend `src/index.test.ts` with `mountWorker` tests that check both request handlers are registered, reject a caller whose contribution ID is not `mqtt-credentials`, and return only the configured boolean or refresh-started result (never the stored password).

- [x] **Step 2: Run the panel tests and verify they fail**

Run: `orca plugin test .`

Expected: FAIL because there is no panel contribution, panel module, or worker request contract.

- [x] **Step 3: Declare the panel request contract and contribution**

In `src/panel-contract.ts`, augment module `orca` with two typed requests: `publisher.passwordStatus`, returning `{ configured: boolean }`, and `publisher.credentialsChanged`, returning `{ refreshStarted: true }`. Neither request accepts input.

Add `contributes.panels` in `orca-plugin.json` with one `mqtt-credentials` panel, title `MQTT Password`, `ui: "components"`, and entry `src/panel.ts`. Preserve the existing `trusted-worker` execution profile; Orca's manifest supports component panels at the current minimum version.

- [x] **Step 4: Implement the panel and worker handlers**

Build `src/panel.ts` from Orca components (`Stack`, `Heading`, `Text`, `Input`, and `Button`). Use a password-typed input with ephemeral panel state, save/clear controls, configured/not-configured status, and safe error text. Query `orca.secrets.protection` and do not attempt a save when protection is unavailable. Save and clear through `orca.secrets.set/delete`; clear the entered value after save. The panel must not call `secrets.get` or place the password in a worker request.

In `src/index.ts`, register both handlers with `orca.panels.handle`. Verify `context.panel.contributionId === 'mqtt-credentials'`. The status handler reads the secret in the worker and returns only a boolean. The changed handler calls the serialized refresh path from Task 2 and returns `{ refreshStarted: true }` after the old client is closed and the new client is created; reject with a safe error if loading or replacement fails.

The changed handler resolves after the old client is closed and the new client is created, not after the broker accepts it. The panel reports that the connection attempt started; the existing status bar remains authoritative for connecting/connected/error state.

Add `src/panel.test.ts` to the Orca component test runner and exclude it from Vitest's default discovery in `vitest.config.ts` by importing `configDefaults` from `vitest/config` and setting `exclude: [...configDefaults.exclude, 'src/panel.test.ts']`; Orca's `orca/testing` module is available under `orca plugin test`, not the Vitest runtime. Keep `src/index.test.ts` in Vitest.

- [x] **Step 5: Run panel and worker tests and commit**

Run: `orca plugin test .`

Run: `npm test -- src/index.test.ts`

Expected: PASS for save/clear, status reporting, no secret in panel output or worker requests, and safe failure messages.

Commit with `feat: add secure MQTT password panel`.

### Task 4: Document setup and validate Orca behavior

**Files:**
- Modify: `README.md`
- Review: `orca-plugin.json`, `src/settings/settings.ts`, `src/index.ts`, `src/panel.ts`

- [x] **Step 1: Document user configuration**

Update `README.md` to explain where native settings appear, list the supported settings and defaults, show that only the two confirmed agent-turn events can be enabled, and explain that both start OFF. Document the MQTT Password panel's save/clear behavior, Orca encrypted secret-store requirement, the fact that the password is never shown or logged, and that changing settings reconnects the publisher. Update capability documentation from `storage:own` to `settings:own`, retaining reasons for `secrets:own` and `agent:read`.

- [x] **Step 2: Run all targeted repository checks**

Run each command separately:

```bash
npm test -- test/settings/settings.test.ts test/events/orca-adapter.test.ts test/mqtt/publisher.test.ts src/index.test.ts src/worker.test.ts
npm run lint
npm run typecheck
npm run orca:validate
npm run orca:check
npm run orca:test
orca plugin test .
git diff --check
```

Expected: all commands pass, the manifest accepts settings and component panel contributions, and CI reports 100% diff coverage.

- [ ] **Step 3: Smoke-test the plugin in Orca**

Load the working tree with the installed Orca CLI. Confirm the settings appear under the plugin in Orca Settings; change an event mode and broker preference and verify status reflects reconnection; save then clear a test password in the panel; confirm status shows configured/not configured without showing the value. Confirm startup still warns when all supported event modes are OFF. Do not publish, release, or submit a catalog entry.

Local smoke evidence: Orca loaded the approved development plugin, returned
the configured boolean, accepted a credential refresh request, and logged the
all-events-off warning. The desktop interactions remain open because Orca
Computer Use requires Accessibility permission. The password save and clear
flows pass in the Orca component tests.

- [x] **Step 4: Commit user documentation**

Commit with `docs: document publisher settings`.

## Plan self-review

- **Spec coverage:** Native settings and defaults, stable generated client ID, only two supported event-mode controls, secure password save/clear, password non-disclosure, settings-change and password-change reconnection, graceful cleanup, explicit failure behavior, README instructions, automated tests, Orca validation, and an in-app smoke test are all assigned.
- **Scope:** This is one cohesive feature: the panel and settings API both configure the same worker-owned publisher. It does not add unsupported events, expand capabilities beyond `settings:own`, `secrets:own`, and `agent:read`, or alter MQTT protocol behavior.
- **Type consistency:** `PublisherSettings` remains the runtime model; the manifest's `agentTurnStartedMode` and `agentTurnEndedMode` map to `devevents.agent.turn.started` and `devevents.agent.turn.ended`. Panel requests return only status and refresh success, never credentials.
- **Placeholder scan:** No TODO/TBD steps or unspecified dependencies remain. Exact Orca settings, panel, worker request, testing, and npm/Orca validation APIs are named.
