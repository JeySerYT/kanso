import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../src/store.js'

function freshStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-'))
  const store = openStore(join(dir, 'board.db'))
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

const sessionA = { session: 'ses_a', cwd: '/work/a' }
const sessionB = { session: 'ses_b', cwd: '/work/b' }

test('touch записывает файлы в аренду', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, sessionA)

  const result = store.touchTask(task.id, { ...sessionA, paths: ['src/app.js', 'src/ui.js'] })

  assert.equal(result.ok, true)
  assert.deepEqual(store.getTask(task.id).claim.touched_paths, ['src/app.js', 'src/ui.js'])
})

test('комментарий владельца продлевает аренду', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, { ...sessionA, leaseMs: 60_000 })
  const before = store.getTask(task.id).claim.lease_until

  store.commentTask(task.id, { session: sessionA.session, body: 'прогресс' })

  assert.ok(new Date(store.getTask(task.id).claim.lease_until) > new Date(before))
})

test('move владельца продлевает аренду, чужой комментарий — нет', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, { ...sessionA, leaseMs: 60_000 })
  const claimed = store.getTask(task.id).claim.lease_until

  store.commentTask(task.id, { session: sessionB.session, body: 'чужой' })
  assert.equal(store.getTask(task.id).claim.lease_until, claimed)

  store.moveTask(task.id, { status: 'in_progress', session: sessionA.session })
  assert.ok(new Date(store.getTask(task.id).claim.lease_until) > new Date(claimed))
})

test('тот же файл у другой сессии — отказ', (t) => {
  const store = freshStore(t)
  const one = store.createTask({ title: 'Один', project: 'AniVella' })
  const two = store.createTask({ title: 'Два', project: 'AniVella' })
  store.claimTask(one.id, sessionA)
  store.touchTask(one.id, { ...sessionA, paths: ['src/app.js'] })
  store.claimTask(two.id, sessionB)

  const result = store.touchTask(two.id, { ...sessionB, paths: ['src/app.js'] })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'path_locked')
  assert.equal(result.owner.task_id, one.id)
})

test('вложенный путь открывает тред переговоров', (t) => {
  const store = freshStore(t)
  const one = store.createTask({ title: 'Оптимизация', project: 'AniVella' })
  const two = store.createTask({ title: 'Дизайн', project: 'AniVella' })
  store.claimTask(one.id, sessionA)
  store.touchTask(one.id, { ...sessionA, paths: ['src/components'] })
  store.claimTask(two.id, sessionB)

  const result = store.touchTask(two.id, { ...sessionB, paths: ['src/components/Hero.tsx'] })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'needs_agreement')
  assert.equal(result.thread.state, 'asked')
  assert.equal(result.thread.path, 'src/components/Hero.tsx')
  assert.deepEqual(result.thread.sessions.sort(), ['ses_a', 'ses_b'])
})