import { readFileSync, statSync } from 'node:fs'
import { posix } from 'node:path'
import { expect, test } from 'vitest'
import { isRecord } from '../src/util/is-record'

const root = new URL('../', import.meta.url)
const manifest: unknown = JSON.parse(readFileSync(new URL('orca-plugin.json', root), 'utf8'))

function entryPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(entryPaths)
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'entry' && typeof child === 'string' ? [child] : entryPaths(child)
  )
}

const main = isRecord(manifest) && typeof manifest.main === 'string' ? manifest.main : ''
const paths = [main, ...entryPaths(manifest)]

test('declares a worker main and at least one entry', () => {
  expect(main).not.toBe('')
  expect(paths.length).toBeGreaterThan(1)
})

test.each(paths)('%s exists as a file', (path) => {
  expect(statSync(new URL(path, root)).isFile()).toBe(true)
})

test.each(paths)('%s is not inside node_modules', (path) => {
  expect(posix.normalize(path).split('/')).not.toContain('node_modules')
})
