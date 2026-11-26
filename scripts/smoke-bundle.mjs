// Loads the manifest's `main` the way a git install sees it: tracked files only, no npm install.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const source = resolve(process.argv[2] ?? '.')
const checkout = mkdtempSync(join(tmpdir(), 'orca-plugin-smoke-'))
const failures = []

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

try {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
  for (const file of tracked) {
    mkdirSync(dirname(join(checkout, file)), { recursive: true })
    copyFileSync(join(source, file), join(checkout, file))
  }

  const { main } = JSON.parse(readFileSync(join(checkout, 'orca-plugin.json'), 'utf8'))
  if (!tracked.includes(main)) throw new Error(`main "${main}" is not tracked by git`)
  const entry = join(checkout, main)

  // The real host provides `orca` and `orca/*`.
  write(
    join(checkout, 'node_modules/orca/package.json'),
    JSON.stringify({ name: 'orca', type: 'module', exports: { '.': './s.js', './*': './s.js' } })
  )
  write(join(checkout, 'node_modules/orca/s.js'), 'export {}\n')

  // Orca resolves extensionless relative imports in TypeScript sources; plain Node does not.
  // Bare package specifiers are left to Node.
  const loader = `
    import { registerHooks } from 'node:module'
    registerHooks({
      resolve(specifier, context, next) {
        const fromTs = context.parentURL?.endsWith('.ts')
        const extensionless = specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)
        return next(fromTs && extensionless ? specifier + '.ts' : specifier, context)
      }
    })
    const worker = await import(${JSON.stringify(pathToFileURL(entry).href)})
    if (typeof worker.default !== 'function') throw new Error('main has no default activate export')
  `
  const load = spawnSync(process.execPath, ['--input-type=module', '--eval', loader], {
    cwd: checkout,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    timeout: 30_000
  })
  if (load.status !== 0) failures.push(`importing ${main} failed:\n${load.stderr || load.error}`)

  // Marking everything external makes esbuild list the file's own imports without following them.
  const { metafile } = await build({
    absWorkingDir: checkout,
    entryPoints: [main],
    bundle: true,
    external: ['*'],
    format: 'esm',
    platform: 'node',
    metafile: true,
    write: false,
    outdir: 'scan',
    logLevel: 'silent'
  })
  for (const { path, kind, external } of Object.values(metafile.inputs).flatMap(
    (input) => input.imports
  )) {
    const allowed = isBuiltin(path) || path === 'orca' || path.startsWith('orca/')
    if (external && kind === 'import-statement' && !allowed) {
      failures.push(`${main} statically imports "${path}"; only node builtins and orca are allowed`)
    }
  }

  if (failures.length === 0) console.log(`smoke: ${main} loads from a clean checkout`)
} catch (error) {
  failures.push(error.message)
} finally {
  rmSync(checkout, { recursive: true, force: true })
}

for (const failure of failures) console.error(`smoke: ${failure}`)
process.exitCode = failures.length === 0 ? 0 : 1
