import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { defaultRoots, discoverRepositories } from '../src/git.js'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

function makeRepo(root, name, { branch = 'feature' } = {}) {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  execFileSync('git', ['init', '-b', 'main'], { cwd: path, stdio: 'ignore' })
  writeFileSync(join(path, 'file.txt'), 'one')
  execFileSync('git', ['add', '.'], { cwd: path, stdio: 'ignore' })
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-m', 'init'],
    { cwd: path, stdio: 'ignore' },
  )
  execFileSync('git', ['branch', branch], { cwd: path, stdio: 'ignore' })
  return path
}

test('находит репозитории на заданной глубине и читает ветки', { skip: !hasGit }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kanso-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = makeRepo(join(root, 'apps'), 'Demo')

  const found = discoverRepositories({ roots: [root], depth: 3 })

  assert.equal(found.length, 1)
  assert.equal(found[0].path, repo)
  assert.equal(found[0].name, basename(repo))
  assert.equal(found[0].current_branch, 'main')
  assert.deepEqual(found[0].branches.sort(), ['feature', 'main'])
})

test('не спускается внутрь node_modules и вложенных репозиториев', { skip: !hasGit }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kanso-git-skip-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  makeRepo(join(root, 'node_modules'), 'ignored')
  makeRepo(root, 'Demo')
  makeRepo(join(root, 'Demo', 'vendor'), 'nested')

  const found = discoverRepositories({ roots: [root], depth: 4 })

  assert.deepEqual(found.map((repo) => repo.name).sort(), ['Demo'])
})

test('KANSO_ROOTS переопределяет корни сканирования', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'kanso-roots-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nested = join(root, 'one')
  mkdirSync(nested)

  assert.deepEqual(defaultRoots({ KANSO_ROOTS: nested }), [nested])
})