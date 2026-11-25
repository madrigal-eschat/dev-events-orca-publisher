# Maintaining the Orca publisher

Use the Node version in `.nvmrc` and install dependencies with `npm ci`.
Run `npm run lint`, `npm run typecheck`, and `npm test -- --coverage`.
Compare changed executable lines with `origin/main` using
`diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=100`.
For real MQTT delivery, run `./scripts/integration-test.sh` or set
`MQTT_INTEGRATION_URL` to a throwaway loopback Mosquitto broker.

Run `orca plugin validate .`, `orca plugin check .`, and `orca plugin test .`
locally. The Orca test runner includes the MQTT Password panel tests. Run
`orca plugin dev watch .` for development and see `orca plugin dev emit --help`
for event injection. Verify native settings, reconnection, and password save
and clear in Orca desktop with encrypted secret storage available.

Keep event mappings aligned with dev-events 1.1. Allowlist emitted fields and
keep prompts, output, file contents, and credentials out of payloads and logs.
Both event modes default to OFF. Store the broker password through Orca's
encrypted secret store. See the README for installation, settings, and the
supported event mapping.

Keep shared workflow references pinned to released commits. Semantic-release
handles the GitHub release. Generate the catalog entry locally with
`orca plugin release-entry .` at the released commit and review it before
manual catalog submission.
