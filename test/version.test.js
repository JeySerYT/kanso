import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('VERSION и package.json совпадают', () => {
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  assert.equal(pkg.version, version)
})

test('версия в формате X.Y.Z со стадией', () => {
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()

  assert.match(version, /^\d+\.\d+\.\d+(-(alpha|beta)\.\d+)?$/)
})