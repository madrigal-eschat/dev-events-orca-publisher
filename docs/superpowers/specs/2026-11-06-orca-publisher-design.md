# dev-events Orca publisher: design

Status: approved in conversation 2026-11-06 (decisions marked **[decided]** come
from the project owner; **[call]** marks a decision made on the owner's behalf
that they have not explicitly reviewed; **[builder]** is left to whoever builds
this).

## Intent

dev-events is a protocol, plus a set of apps, for publishing and consuming IDE
events over an MQTT bus (`madrigal-eschat/dev-events-mqtt`, see its README and
`MESSAGE-FORMAT.md`). Collecting events is decoupled from using them, so a
small producer per editor is enough and consumers (home-assistant, stats,
haptics, ...) can live anywhere on the bus.

[Orca](https://github.com/stablyai/orca) is an editor and the place where the
owner runs coding agents in parallel worktrees. This project is the Orca
counterpart of `madrigal-eschat/dev-events-jetbrains-publisher`: an Orca
plugin that publishes Orca's activity as dev-events messages. **[decided]**

What happens to the events at the other end is out of scope. **[decided]**

## Goals

1. Publish the *ordinary editor events* Orca can observe, using the existing
   `devevents.*` types from `MESSAGE-FORMAT.md`: file saved/opened/closed,
   editor focus gained/lost, VCS commit and branch change (and push if Orca
   exposes it), task and test lifecycle where Orca has a meaningful notion of
   one. **[decided]** Publish only the subset Orca can really observe; the
   protocol allows any subset.
2. Publish new *agent lifecycle events*, proposed as **dev-events 1.1**
   (a minor bump: new event types only, envelope unchanged). **[decided]**
3. Same envelope and source conventions as the JetBrains publisher:
   CloudEvents 1.0, `sourcetype: "editor"`, `source: editor/{host}/orca`
   (`family` = `orca`, `specific` omitted). **[decided]**
4. Settings and privacy behaviour identical to the JetBrains publisher
   (see "Settings and privacy"). **[decided]**
5. A repository that meets the madrigal-eschat CI standard plus gitleaks, and
   follows Orca plugin best practice (see below). **[decided]**

## Non-goals and anti-goals

- Consuming events, dashboards, automations, haptics: not this project.
- Supporting editors other than Orca.
- Anti-goal: leaking anything the user did not opt in to. A publisher that
  works but publishes agent prompts, file contents, paths or credentials by
  default is a failure. Redaction must be safe by construction, not by remembering
  to strip fields.
- Anti-goal: quietly working around a platform limit. **[decided]** If Orca
  plugins cannot do something this design needs (see "Left to the builder"),
  stop and report it to the owner with the options. Nothing further is built
  until the owner decides; in particular do not introduce a companion process
  on your own.

## Wire format

Follow `dev-events-mqtt/MESSAGE-FORMAT.md` exactly; read it and the JetBrains
publisher (`MqttPublisherService.kt`, `PluginSettings.kt`) before starting.

- Envelope: CloudEvents 1.0 JSON; `type`, `id` (UUID), `time`, `source`,
  `sourcetype: "editor"`, optional `subject`, `data`.
- `source`: `editor/{host}/orca`; `host` is the first label of the hostname and
  user-configurable (redaction).
- `subject`: project/worktree root, home-relative (`~/...`), omitted or masked
  according to settings.
- Topic: `{topicPrefix}/{hostname}` when "include host" is on (default prefix
  `ide-events`, as in the JetBrains plugin).
- Fire-and-forget, QoS 0, never block Orca's UI or an agent on publish.
- Optional fields are omitted entirely, never null (spec rule).

### Event mapping (Orca to dev-events)

Table of events to publish; the builder fills in the Orca side after discovery
and records the final mapping in the README. Anything Orca cannot observe is
skipped and listed under "Unsupported" in the README.

| dev-events type | Orca trigger (builder to confirm) |
|---|---|
| `devevents.file.saved` / `opened` / `closed` | editor file activity |
| `devevents.editor.focus.gained` / `lost` | Orca window focus |
| `devevents.vcs.committed` / `branch.changed` / `pushed` | git activity in a worktree |
| `devevents.task.*`, `devevents.test.*` | only if Orca exposes task/test runs; otherwise skip (do not guess from terminal output) |

### New agent lifecycle events (dev-events 1.1) **[call: names and fields]**

Proposed types, to be aligned with Orca's real agent states once known:

| type | meaning |
|---|---|
| `devevents.agent.started` | an agent session began in a worktree |
| `devevents.agent.working` | the agent is actively working |
| `devevents.agent.waiting` | the agent needs the user (input/permission) |
| `devevents.agent.idle` | the agent finished a turn and is idle |
| `devevents.agent.finished` | the agent session ended normally |
| `devevents.agent.failed` | the agent session ended abnormally |

Data fields (all optional unless noted; privacy per-event as below):
`agent` (required: product id, e.g. `claude`, `copilot`, `codex`), `session`
(opaque id), `worktree` (home-relative path), `reason` (for `waiting`/`failed`,
short machine-readable code, never free text from the agent). Agent prompts,
output and file contents are never published, in any mode. **[call]**

Deliverable: a pull request to `madrigal-eschat/dev-events-mqtt` adding these
types to `MESSAGE-FORMAT.md` with a "version 1.1" note, merged before or
together with the first release of this publisher.

## Settings and privacy **[decided: same as JetBrains]**

- Broker URL (`tcp://host:1883`), username, password, client ID.
  **[decided]** The password is never written to plain plugin settings, plugin
  storage or logs. If Orca's plugin API offers a real secret store, use it.
  If it does not, do not store the password at all: read it at connect time
  from a file path the user configures (not an environment variable). Do not
  invent your own encryption. Document the chosen mechanism in the README.
- Topic prefix (default `ide-events`), include-host toggle, host label.
- Home subnet (CIDR): publish only when a local IPv4 address matches; blank
  means always publish.
- Per-event mode: OFF / REDACTED / FULL. Events without sensitive fields
  (VCS commit, test started, focus gained/lost) treat REDACTED as FULL, as in
  the JetBrains plugin.
- Defaults must match the JetBrains plugin's defaults (read them from its
  `PluginSettings`); if every event is OFF, show a startup notice.
- A way to see current connection state and last publish error (a small
  status surface in the plugin panel or logs), because failures are silent by
  design. **[call]**

## Constraints and platform notes

- Language: TypeScript on Orca's `trusted-worker` plugin runtime
  (`orca plugin create <dir> --template ...`; `hook` and `worker-panel`
  templates exist). **[call]** An MQTT client library must run inside that
  worker.
- Orca plugin manifest `manifestVersion: 2`, `pluginApi: 1`; the plugin asks
  for the minimum capabilities and nothing more (each capability needs user
  approval); document every requested capability and why in the README.
- Orca CLI tools to use in dev and CI: `orca plugin validate`,
  `orca plugin test`, `orca plugin check`, `orca plugin dev watch|emit`,
  `orca plugin release-entry` (for the catalog entry, from committed HEAD).
- Known quirk at design time: on the author's Orca install, `orca plugin
  create` and `orca plugin types` scaffold files but fail copying
  `orca.d.ts` ("ENOENT ... declarative/orca.d.ts"). If it persists,
  update Orca or vendor the typings; do not hand-write types.

## Repository and CI (madrigal-eschat standard, plus gitleaks) **[decided]**

Hosting: `madrigal-eschat/dev-events-orca-publisher` on GitHub (primary), later
mirrored to GitLab (`git.telynz.uk/madrigal-eschat/`) by the owner's
infrastructure; creating the GitHub repository and the mirror are the
owner's/PA's tasks, not the builder's. License Apache-2.0.

Baseline files (copy the shape from `dev-events-jetbrains-publisher` and
`dev-events-mqtt`): `README.md`, `CLAUDE.md`, `LICENSE`, `CHANGELOG.md`
(generated), `.github/CODEOWNERS` (`* @madrigal-eschat`), `commitlint.config.mjs`
(conventional), `.releaserc.json` (semantic-release), `.gitignore`,
`.editorconfig`, `.markdownlint.jsonc`, `.github/dependabot.yml` and
`.github/workflows/dependabot-auto-merge.yml` (patch/minor only), toolchain pin
(`.nvmrc` or `.tool-versions`, `engines`).

CI workflows call the shared reusable workflows in
`madrigal-eschat/ci-workflows`, pinned to a commit SHA with a version comment
(as `dev-events-mqtt` does, currently v1.1.0):

- existing and reusable as is: `_commitlint.yml`, `_markdown-lint.yml`,
  `_prose-lint.yml`, `_semrel.yml`.
- **missing, add them to `ci-workflows` (separate PR there, new minor release)
  and consume them here:**
  - `_node-ci.yml`: generic Node/TypeScript CI only: install with lockfile,
    lint, typecheck, and the project's own test script (`npm test`). Nothing
    Orca-specific belongs in `ci-workflows`.
  - `_node-coverage.yml`: diff coverage gate at 100% like the existing
    `_kotlin-coverage.yml` and `_rust-coverage.yml` (diff-cover against the
    base branch).
  - `_gitleaks.yml`: gitleaks over the full history on pull requests and
    pushes, fails the build on findings. madrigal-eschat has no gitleaks
    anywhere yet; once the reusable workflow exists, also record in the
    ci-workflows README that other repos should adopt it (adopting it in
    other repos is out of scope).
- Add gitleaks as a pre-commit hook as well (`.pre-commit-config.yaml`)
  together with commitlint if the owner's other repos do; otherwise skip
  pre-commit. **[builder]** check `dev-events-jetbrains-publisher`.
- `.gitleaksignore` entries need a comment each; history findings are
  permanent, HEAD findings should be fixed, not ignored.
- Release: semantic-release on `main` via `_semrel.yml`, bump the version in
  `orca-plugin.json`, update `CHANGELOG.md`, GitHub release. Publishing to an
  Orca plugin catalog (`orca plugin release-entry`) is documented but left as a
  manual step, like Marketplace publishing for the JetBrains plugin.

## Testing

- Unit tests for mapping, envelope building, redaction, home-subnet check and
  settings, with the MQTT client and Orca API faked.
- Integration test against a throwaway Mosquitto (`docker-compose.yml` and
  `mosquitto/mosquitto.conf`, `scripts/integration-test.sh`, as in the
  JetBrains plugin): publish an event, assert the envelope arrives on the
  expected topic.
- Contract test: validate generated envelopes against the format in
  `MESSAGE-FORMAT.md` (a JSON schema checked into the repo is fine).
- Diff coverage 100% (CI gate above).

## Order of work **[call]**

1. **Discovery spike** (throwaway, do not keep the code): list Orca's
   observable events and agent states; confirm the plugin worker can make an
   outbound MQTT connection and which client library works; check secret
   storage and what UI surfaces exist. Write the findings into
   `docs/superpowers/notes/`. If MQTT is not possible, stop here and report.
2. Draft the dev-events 1.1 agent event types from the real agent states and
   open the PR against `madrigal-eschat/dev-events-mqtt`. The builder may open
   PRs against `dev-events-mqtt` and `ci-workflows`; the owner reviews and
   merges them, and creates the GitHub repository and the GitLab mirror.
3. Add `_node-ci`, `_node-coverage` and `_gitleaks` to `ci-workflows` (PR,
   owner merges and releases). While that PR is in review, this repo may
   reference the workflows by branch; the pin must be a released commit SHA
   before this repo's own CI PR merges.
4. Build the plugin with tests, then integration test, then docs and release.

Minimum for a first release: the agent lifecycle events. Editor events are
best-effort; if few or none map to what Orca can observe, ship agent-only and
say so in the README ("Unsupported").

Event fields: `subject` is the worktree root; `source` host is the machine's
hostname; `session` is the agent's session id so concurrent agents can be told
apart.

Coverage: the 100% diff gate applies. A thin adapter layer around the Orca API
and UI may be excluded from coverage, with an explicit, reviewed exclusion
list; everything else is covered.

Status surface: logs are always required; add a panel only if Orca's plugin
API offers one.

## Left to the builder

- Which Orca events and state transitions exist, and the real names/shape of
  agent states; the final mapping table.
- Whether an Orca plugin worker may open an MQTT connection (TCP/WebSocket
  capability) and which MQTT client library works there. **This is the main
  risk, and the first thing to find out** (see "Order of work"). **[decided]**
  If it cannot, stop and report to the owner with the options (for example a
  small companion process the plugin talks to); do not choose one silently and
  do not carry on building.
- Whether Orca offers a real secret store (see "Settings and privacy" for what
  to do either way).
- Project layout, test runner, lint stack (ESLint/Prettier or Biome, match
  what the `ci-workflows` Node jobs will standardise), TypeScript config.
- Exact settings UI (panel/components) within what Orca provides.
- How the plugin identifies the host label and detects local IPv4 addresses
  inside the worker sandbox.

## Calls made on the owner's behalf (please review)

1. TypeScript worker plugin as the architecture.
2. Agent event names and data fields above, and the rule that prompts and agent
   output are never published in any mode.
3. A visible connection/last-error status surface (logs required, panel if
   Orca offers one).
4. GitHub primary with GitLab mirror (matching the other madrigal-eschat repos).
5. Adding `_node-ci`, `_node-coverage` and `_gitleaks` to `ci-workflows` as
   part of this work, rather than inline workflows in this repo.
6. Apache-2.0 licence, catalog publishing left manual.
