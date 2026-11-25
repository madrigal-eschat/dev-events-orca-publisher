# dev-events Orca Publisher

The Orca plugin publishes confirmed agent turn lifecycle events as CloudEvents
1.0 over MQTT, using the dev-events protocol's agent event types from version
1.1. It publishes only Orca signals that map unambiguously to the protocol.

## Install

Clone this repository, then run `npm ci` and `orca plugin install .` from the
checkout. Review Orca's capability prompt before approving the plugin. To work
on the plugin locally, run `orca plugin dev watch .`.

## Confirmed mapping

| Orca signal                                                          | dev-events event               | Data                          |
| -------------------------------------------------------------------- | ------------------------------ | ----------------------------- |
| `agent.status.changed`, state `working`                              | `devevents.agent.turn.started` | `{}`                          |
| `agent.status.changed`, state `blocked` or `waiting`                 | `devevents.agent.turn.ended`   | `{ "reason": "waiting" }`     |
| state `done`, outcome `success`                                      | `devevents.agent.turn.ended`   | `{ "reason": "finished" }`    |
| state `done`, outcome `failure`                                      | `devevents.agent.turn.ended`   | `{ "reason": "failed" }`      |
| state `done`, outcome `cancellation`, `interruption` or `superseded` | `devevents.agent.turn.ended`   | `{ "reason": "interrupted" }` |

A `done` state without a confirmed outcome emits nothing. The `unconfirmed`
outcome is intentionally left unmapped; its status is an open question. Orca
does not provide a reliable signal for
`devevents.agent.started` or `devevents.agent.exited`, so this plugin does not
emit those event types.

## Configure in Orca

Open the Orca Settings screen and select **dev-events Orca Publisher** to
configure the plugin's native settings. The two agent turn modes are the only
event controls, and both default to `OFF`.

| Setting                 | Default                | Description                                                                 |
| ----------------------- | ---------------------- | --------------------------------------------------------------------------- |
| Broker URL              | `tcp://localhost:1883` | MQTT broker address. Do not include a username or password in the URL.      |
| Username                | Empty                  | MQTT username. Set the password in the MQTT Password panel.                 |
| Client ID               | Generated              | Leave blank to have the plugin generate and save a stable ID.               |
| Topic prefix            | `dev-events`           | Prefix for published MQTT topics.                                           |
| Include host            | `true`                 | Append the host label to the MQTT topic.                                    |
| Host label              | Empty                  | Override the machine host label in the event source and topic.              |
| Home subnet             | Empty                  | Publish only when a local IPv4 address matches this CIDR.                   |
| Include project         | `true`                 | Include the project subject when available. Orca agent turn events omit it. |
| Agent turn started mode | `OFF`                  | `OFF`, `REDACTED`, or `FULL`.                                               |
| Agent turn ended mode   | `OFF`                  | `OFF`, `REDACTED`, or `FULL`.                                               |

Changing a setting reconnects the publisher with the updated configuration.
The plugin warns at startup when both supported event modes are `OFF`.
The **MQTT** status bar item shows the connection state. Its tooltip shows the
latest error code when present. Orca's plugin logs record connection state
changes and a diagnostic code whenever a connection attempt ends in an error. For
example, `connection_refused` means the broker's TCP port refused the connection,
and `broker_auth_failed` means the broker rejected authentication or authorization.
The logs show the broker scheme, hostname, and any explicit port on each
connection attempt, and indicate when the attempt uses configured credentials.

A blank home subnet permits publishing on any network. With `Include host`
enabled, the default topic is `dev-events/<host>`. Turning it off publishes to
`dev-events`. The configured machine label still appears in the CloudEvent source.

### MQTT password

Open the **MQTT Password** panel to save or clear the broker password. Orca
must have encrypted secret storage backed by the OS keyring; password saving
is unavailable when Orca cannot confirm that protection is available. The panel
shows only whether a password is configured. It never displays or logs the
password. Saving or clearing the password refreshes the publisher connection.

## Unsupported signals

- `workspace.created` and `workspace.removed` do not represent a dev-events
  lifecycle event.
- `workspace.changed` is also emitted for focus and terminal changes, so it cannot
  reliably identify a VCS branch change.
- Orca has no confirmed file-open/close/save, editor-focus, commit, push,
  task, or test event suitable for this publisher. `editor.save.before` is
  pre-save and includes file contents, so it is intentionally not used.
- Agent launch, prompt, and tool callbacks are not used; they are not needed to
  map agent status and can expose prompts or output.

## Event data and privacy

The adapter constructs event names and payloads from an allowlist; it never
forwards an Orca callback object. Agent and session identifiers are omitted
because Orca's status event does not define them as protocol identifiers.
Workspace IDs, terminal IDs and titles are also omitted. The status event
provides no worktree path, so `worktree` and `subject` are omitted.

Prompts, agent output, terminal contents, file contents, paths, and credentials
are never included in event payloads. The mapper constructs a safe payload
directly from the agent `state` and, for `done`, `mainAgent.outcome`. Settings
default to OFF; FULL and REDACTED are equivalent for these events because the
allowlisted reason is not sensitive.

## Requested Orca capabilities

- `settings:own` reads and responds to changes in the publisher's native
  settings.
- `secrets:own` saves, reads, and clears the broker password in Orca's
  encrypted secret store.
- `agent:read` subscribes to `agent.status.changed`.

No workspace capability is requested because no workspace event is used to
construct a published message.

## Local maintainer checks

Run `npm ci`, `npm run lint`, `npm run typecheck`, and
`npm test -- --coverage`. For the MQTT integration test, run
`./scripts/integration-test.sh` with Docker Compose, or set
`MQTT_INTEGRATION_URL` to a local throwaway broker listening on loopback.

GitHub Actions runs the npm suite and enforces 100% diff coverage. The Orca
CLI checks run locally. Run `orca plugin validate .` for the manifest,
`orca plugin check .` to render the panel against simulated Orca APIs, and
`orca plugin test .` to exercise the password panel with Orca's test runner.
The panel entry point is the sole application file excluded from Vitest
coverage. Load the development plugin with `orca plugin dev load .` and follow
its logs with `orca plugin dev watch .`. To exercise the turn-start handler, run

```sh
orca plugin dev emit . agent.status.changed --data '{"workspaceId":null,"paneKey":"p1","state":"working","receivedAt":1}'
```

Live settings changes,
reconnection, and encrypted password save and clear require a desktop check.

## Release

Semantic-release runs on `main` and publishes the GitHub release with the
generated changelog and versioned plugin manifest. Run
`orca plugin release-entry .` from the released commit, review the generated
entry, and submit it to the Orca catalog manually.
