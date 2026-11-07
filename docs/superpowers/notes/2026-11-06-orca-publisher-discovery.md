# Orca publisher discovery

## Gate result

**GO (Task 1 feasibility passed).** After the owner approved the trusted-worker
grant in Orca, the live worker connected to the loopback Mosquitto broker and
published a QoS 0 message; the broker log confirmed receipt on `orca/discovery`.
The worker also completed an encrypted-secret round-trip, obtained IPv4
interface metadata, and updated a visible status-bar item. MQTT.js ran
asynchronously in Orca's separate Node worker and the desktop remained
responsive during the request. UI approval was required and obtained. Task 2
was not started, per the user's scope instruction.

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
- Orca's official v1.4.251 declarations were retrieved from the nine requested
  raw source URLs and placed in the throwaway plugin's `.orca/types/`; no
  replacement API declarations were authored. The matching MIT `LICENSE` was
  also included after approval. Nothing from these files was added to the
  repository.
- One MQTT client was installed only in the throwaway directory:
  `mqtt@5.16.1`. The plugin validated after moving its root under that
  directory so Node could resolve the parent `node_modules` without Orca
  rejecting npm's `.bin` symlinks.
- `orca plugin validate .../plugin --json` → valid trusted-worker. `orca plugin
  inspect .../plugin --json` reports `trusted-worker`, the `secrets:own`
  capability, and a status-bar item.
- `orca plugin dev load .../plugin --json` → `approval_required`. The returned
  grant was trusted-worker execution, `secrets:own`, and the status-bar item.
  UI approval was needed; after the owner approved this exact grant, the
  returned fingerprint was accepted by `--approve` and the plugin ran as a
  development plugin. It was unloaded after the live test.

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
  unavailable. In the approved live worker, `secrets.protection` returned
  `os-keyring`; set/get/delete and post-delete absence checks completed
  successfully. The temporary value was not logged.
- There is no worker host API for reading a configurable file. The frame API's
  `files.saveAs` is a user-gesture save dialog, not a file-read facility.
- `orca.log()` and `orca plugin logs` provide a log/status surface. Orca 1.4.251
  supports declarative status-bar items and worker `statusBar.update`; the
  status-bar item needs no additional capability. A live `orca plugin shot
  --status-bar` had no render errors and showed `MQTT: published`.
- The worker host API has no local-IPv4 method. The prepared worker checks
  Node's `os.networkInterfaces()` and logs only counts. The live worker found
  one non-internal IPv4 interface, classified as private; the address itself
  was not logged.
- Orca describes `trusted-worker` as a separate Node.js process on the Orca
  host with the user's account access. No MQTT/network-specific host API or
  capability was found. Orca's requested grant for the prepared experiment
  was trusted-worker execution plus `secrets:own`.

## MQTT experiment and remaining constraints

- `mqtt@5.16.1` was selected and installed; the worker publisher uses
  `mqtt://127.0.0.1:1883`, QoS 0, and callback-based async completion. This was
  executed from the live trusted worker through `orca plugin dev request`.
- Docker Compose started `eclipse-mosquitto:2.0.22`; `docker compose config`
  confirmed the only published host binding was `127.0.0.1:1883`. With
  `log_type all`, Mosquitto recorded `Received PUBLISH` on `orca/discovery`
  with QoS 0 (35 bytes), followed by a clean `DISCONNECT`.
- The first publish attempt's MQTT.js callback returned before the broker log
  showed a PUBLISH. The temporary worker had immediately called
  `client.end(true)`, which force-destroyed the socket after the QoS 0 stream
  write. Changing the test to graceful `client.end(false, callback)` produced
  broker-confirmed receipt; the callback alone is not receipt evidence.
- The worker request returned `{ published: true, qos: 0 }`; its secret-store
  checks returned `os-keyring`, and its IPv4 diagnostic reported one private
  interface. The live status-bar screenshot showed the published state. The
  publisher uses async MQTT.js callbacks in the worker process; the Orca
  desktop remained responsive and showed the status update.
- The official typings were placed in `.orca/types/` for the throwaway
  experiment; no replacement API declarations were authored. Preserve the
  generated `src/worker.ts` entry pattern in any later work.
- Final gate: **GO for MQTT feasibility only**. The requested scope stopped at
  Task 1; no Task 2 or product implementation was started. The unloaded
  temporary plugin and npm files remain under
  `/tmp/orca-publisher-discovery-2026-11-06`; the shell policy denied removal.
