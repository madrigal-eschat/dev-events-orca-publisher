# dev-events Orca Publisher

The Orca plugin publishes confirmed agent turn lifecycle events as CloudEvents
1.0 over MQTT, using the dev-events protocol's agent event types from version
1.1. It publishes only Orca signals that map unambiguously to the protocol.

## Confirmed mapping

| Orca signal                                                          | dev-events event               | Data                          |
| -------------------------------------------------------------------- | ------------------------------ | ----------------------------- |
| `agent.status.changed`, state `working`                              | `devevents.agent.turn.started` | `{}`                          |
| `agent.status.changed`, state `blocked` or `waiting`                 | `devevents.agent.turn.ended`   | `{ "reason": "waiting" }`     |
| state `done`, outcome `success`                                      | `devevents.agent.turn.ended`   | `{ "reason": "finished" }`    |
| state `done`, outcome `failure`                                      | `devevents.agent.turn.ended`   | `{ "reason": "failed" }`      |
| state `done`, outcome `cancellation`, `interruption` or `superseded` | `devevents.agent.turn.ended`   | `{ "reason": "interrupted" }` |

A `done` state without a confirmed outcome emits nothing. The `unconfirmed`
outcome remains an open mapping question and is intentionally not mapped by
this task. Orca does not provide a reliable signal for
`devevents.agent.started` or `devevents.agent.exited`, so this plugin does not
emit those event types.

## Unsupported signals

- `workspace.created` and `workspace.removed` do not represent a dev-events
  lifecycle event.
- `workspace.changed` also fires for focus and terminal changes, so it cannot
  reliably identify a VCS branch change.
- Orca has no confirmed file-open/close/save, editor-focus, commit, push,
  task, or test event suitable for this publisher. `editor.save.before` is
  pre-save and includes file contents, so it is intentionally not used.
- Agent launch, prompt, and tool hooks are not used; they are not needed to
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

- `storage:own` stores publisher settings.
- `secrets:own` retrieves the broker password from Orca's encrypted secret
  store.
- `agent:read` subscribes to `agent.status.changed`.

No workspace capability is requested because no workspace event is used to
construct a published message.
