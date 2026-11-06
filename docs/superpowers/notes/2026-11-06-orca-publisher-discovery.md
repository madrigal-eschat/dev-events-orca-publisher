# Orca publisher discovery

## Gate result

**NO-GO (not proven).** The installed Orca build has a trusted-worker runtime,
but this spike did not establish an MQTT connection and publish from that
runtime. A PASS requires that exact evidence. This does not prove that MQTT is
impossible; it means no plugin implementation, protocol/CI change, or
companion process is authorized by this result. The worker-side test needs a
development plugin loaded into the live Orca host with its requested access
approved. That load was not performed.

The topic-prefix default is settled as `dev-events`.

## CLI and scaffold

- `orca --version` → `1.4.251`.
- Template: `hook`.
- `orca plugin create /tmp/orca-publisher-discovery-2026-11-06 --template hook`
  returned an `ENOENT` for
  `/Applications/Orca.app/Contents/Resources/app.asar.unpacked/resources/plugins/declarative/orca.d.ts`.
  The partial scaffold contains `orca-plugin.json`, `src/worker.ts`, and
  `src/worker.test.ts`.
- `orca plugin types /tmp/orca-publisher-discovery-2026-11-06` returned the
  same `ENOENT`. No `orca.d.ts` was found under the installed Orca
  `Contents/Resources`. `orca update --help` returned `Unknown command:
  update`; the CLI offers no update command.
- Generated entry point: `src/worker.ts`. Generated manifest:
  `orca-plugin.json` (`manifestVersion: 2`, `pluginApi: 1`,
  `execution: "trusted-worker"`, `main: "src/worker.ts"`, `terminal.send`
  hook, `onError: "deny"`, minimum Orca `1.4.248`).
- `orca plugin validate /tmp/orca-publisher-discovery-2026-11-06` → valid
  trusted-worker; lists `terminal.send`; loading/enabling requires
  `--approve <fingerprint>`.
- `orca plugin test /tmp/orca-publisher-discovery-2026-11-06` → 1 test passed.
  The CLI documents this as running tests unsandboxed in a local Node process;
  it does not reach the Orca app and is not evidence of a live worker
  connection.

## Observable events and agent states

The installed API source declares a closed set of worker events:

| Orca event | Observed shape and limits |
| --- | --- |
| `workspace.created` | `workspaceId`, `kind` (`worktree` or `folder`), `path`, and `branch`; a worktree root is available. Requires `workspace:read`. |
| `workspace.removed` | `workspaceId`, `kind`, and `path`. Requires `workspace:read`. |
| `workspace.changed` | Focused `context` (`branch`, `displayName`, and terminals with `id` and optional `title`), or `null`; replayed on subscription. Requires `workspace:read`. |
| `agent.status.changed` | `workspaceId` (nullable), `paneKey`, optional `terminalId` and `title`, `state`, `receivedAt`, and optional `mainAgent` (`state`, optional `outcome`, `stateStartedAt`). Requires `agent:read`. |

Agent status values are `working`, `blocked`, `waiting`, and `done`. The
optional main-agent outcome values are `success`, `failure`, `cancellation`,
`superseded`, `interruption`, and `unconfirmed`. These are current status
snapshots/transitions, not distinct session-start/session-finish events. There
is no waiting/failure reason field. The status event contains no agent product
identifier or opaque session ID. `agent.launch.before` does provide an agent
CLI identifier and terminal/workspace IDs, but it is pre-launch, not proof
that a launch succeeded; its `command` may contain a prompt and must not be
read. Correlating it with later status events remains unverified. `paneKey`
and `terminalId` are available identifiers, but the docs do not define either
as an opaque session ID.

Other related hooks do not establish the requested positive events:

- `editor.save.before` fires only before an explicit text-file save (not
  autosave), includes path and text, and can deny or change the save. It does
  not confirm that a file was saved. The hook deadline is 2 seconds.
- `workspace.create.after` is an observation hook for a created worktree or
  folder and includes its path and branch.
- Agent prompt/tool hooks expose prompt, tool input, or tool output; they are
  unnecessary for the status event and must not be consumed for this
  publisher.

No plugin event or hook was found for file opened/closed, confirmed file
saved, editor focus gained/lost, VCS commit/push, or task/test lifecycle.
`workspace.changed` exposes a branch value, but not a commit or push event.
Do not infer unsupported events from terminal text.

## Capabilities and platform surfaces

- Worker event subscriptions require the `main` entry point,
  `trusted-worker` profile, and the domain-specific `workspace:read` or
  `agent:read` capability. Hooks require `main` and `trusted-worker` but no
  declared capability.
- The worker host API has plugin-private storage/settings and an encrypted
  secret store (`secrets.get/set/delete`, `secrets:own`). `secrets.protection`
  reports `os-keyring` or `unavailable`; writes fail when protection is
  unavailable. Runtime availability was not tested.
- `orca.log()` and `orca plugin logs` provide a log/status surface. Orca also
  supports declarative status-bar items and worker `statusBar.update` on this
  installed version (since 1.4.248); a status bar item has no capability
  requirement. The `worker-panel` template is also available.
- The worker API reference has no local-IPv4 method. Whether Node network
  interfaces are usable in this worker was not tested.
- Orca describes `trusted-worker` as a separate Node.js process on the Orca
  host with the user's account access. No MQTT/network-specific host API or
  capability was found. The exact approved access needed for the test was not
  established.

## MQTT experiment and remaining constraints

- `mosquitto --version` → local Mosquitto `2.1.2` is installed. No broker was
  started.
- No MQTT client library was selected or installed, and no broker URL,
  transport, QoS 0 publish, or asynchronous behavior was tested from an Orca
  worker.
- The generated hook's unit test runs under the local Node test runner; it
  cannot substitute for a live worker-to-broker test. A request to load the
  temporary plugin into live Orca was denied because it would install into
  the live host and requires a user decision. No worker code was loaded or
  run in Orca.
- Implementation constraint: preserve the generated `src/worker.ts` entry
  pattern, but first resolve the missing official typings through an Orca
  update or official typings source. Do not hand-write replacement API types.
- The strict gate remains NO-GO until the owner authorizes a live
  trusted-worker test and that worker demonstrably publishes to the local
  broker without blocking Orca. No companion process or follow-on task was
  started.
