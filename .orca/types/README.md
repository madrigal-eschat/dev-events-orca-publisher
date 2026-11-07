# Vendored Orca author typings

These official generated declarations are unchanged from `stablyai/orca` tag
`v1.4.251`. They are vendored because the installed Orca app bundle omits the
declaration files needed by `orca plugin types`.

`orca plugin types` therefore cannot regenerate these files from the installed
app. `orca plugin validate`, `check`, and `test` run headlessly; `check` has no
panels or custom editors to render, and `test` runs the local tests without
starting Orca or exercising a live worker.

- `orca.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/declarative/orca.d.ts
- `orca-components.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/declarative/orca-components.d.ts
- `orca-components-layout.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/declarative/orca-components-layout.d.ts
- `orca-components-data.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/declarative/orca-components-data.d.ts
- `orca-host.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/types/orca-host.d.ts
- `orca-frame.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/types/orca-frame.d.ts
- `orca-worker.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/types/orca-worker.d.ts
- `orca-services.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/types/orca-services.d.ts
- `orca-testing.d.ts`: https://raw.githubusercontent.com/stablyai/orca/v1.4.251/resources/plugins/types/orca-testing.d.ts
