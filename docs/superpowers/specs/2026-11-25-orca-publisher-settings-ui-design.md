# Orca publisher settings UI design

## Context

The publisher currently reads its settings from private plugin storage, but the
manifest exposes no configuration controls. All event modes therefore remain
OFF for users, and broker settings cannot be changed through Orca. The plugin
must expose the settings already required by the approved publisher design
without weakening its credential guarantees.

Orca supports manifest-declared scalar settings in its Settings UI through
`contributes.settings` and the `settings:own` capability. Its encrypted secret
store is separate and remains the only place for the MQTT password.

## Decision

Use Orca's built-in Settings UI for non-secret settings and one small plugin
panel for MQTT password management. This keeps ordinary preferences native
and limits custom UI to the credential operation the manifest settings cannot
securely represent.

Declare the following settings in `orca-plugin.json`:

- Broker URL (`tcp://localhost:1883`), username, topic prefix (`dev-events`),
  include-host toggle, configurable host label, home subnet, and include-project
  toggle.
- Broker URLs must not contain embedded user-info; credentials use the
  separate username setting and encrypted password secret.
- A client ID setting. If blank on first activation, generate a UUID and save
  it so it remains stable across restarts.
- Event mode pickers (`OFF`, `REDACTED`, `FULL`) only for the two currently
  supported events: `devevents.agent.turn.started` and
  `devevents.agent.turn.ended`. Unsupported event types remain disabled and
  must not be presented as configurable events.

Defaults must continue to match the approved design: event modes are OFF,
topic prefix is `dev-events`, host inclusion and project subject are enabled,
and home subnet and host label are blank. A startup warning remains when all
supported events are OFF.

The password panel provides a password input with save and clear actions. It
uses Orca's encrypted `secrets` API; it never reads the existing password back
into the input, stores it in plugin settings/storage, includes it in a worker
request, or logs it. The panel may show whether a password is configured and
must report secret-store failures explicitly without exposing secret values.
After saving or clearing the secret, it asks the worker to refresh the MQTT
connection without transmitting the password.

## Settings and publisher lifecycle

Read non-secret preferences from Orca's declared Settings API and subscribe
to its change notifications. On a settings change, rebuild the typed
`PublisherSettings`, refresh the password directly from the secret store,
gracefully replace the MQTT client, and keep the existing Orca event adapter
registered. A password save/clear request follows the same refresh path.

Replace `storage:own` with `settings:own` if plugin storage has no remaining
consumer. Keep `secrets:own` and `agent:read`; do not request capabilities
solely for the panel. Continue to require Orca 1.4.248 or newer and preserve
the current generated trusted-worker entry-point pattern.

## Privacy and error handling

- Password values are transient in the password input and connection memory,
  and persisted only in Orca's encrypted secret store. Never expose the stored
  value in UI, settings snapshots, logs, status, MQTT data, or command arguments.
- Non-secret setting values remain editable in Orca's plugin Settings screen.
- Connection diagnostics remain allowlisted and sanitized. Panel errors show
  safe status text and never include raw secret values.
- A failed settings read, secret operation, or client replacement must not
  create a success-shaped fallback or silently enable event publishing.

## Verification

Add focused tests for settings-to-model conversion, defaults, generated stable
client IDs, supported-event mode controls, settings-change reconnection,
password save/clear refresh, and secret non-disclosure. Validate the manifest
and panel with Orca tooling, retain 100% diff coverage, and manually verify in
Orca that preferences appear under plugin Settings and password save/clear
works with the encrypted secret store.
