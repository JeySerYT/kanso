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

test('захват переводит задачу в работу и записывает владельца', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })

  const result = store.claimTask(task.id, sessionA)

  assert.equal(result.ok, true)
  assert.equal(result.task.status, 'in_progress')
  assert.equal(result.task.claim.session, 'ses_a')
  assert.ok(new Date(result.task.claim.lease_until) > new Date())
})

test('второй захват возвращает владельца и не меняет задачу', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, sessionA)

  const result = store.claimTask(task.id, sessionB)

  assert.equal(result.ok, false)
  assert.equal(result.code, 'locked')
  assert.equal(result.owner.session, 'ses_a')
  assert.equal(store.getTask(task.id).claim.session, 'ses_a')
})

test('просроченная аренда позволяет забрать задачу', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, { ...sessionA, leaseMs: -1000 })

  const result = store.claimTask(task.id, sessionB)

  assert.equal(result.ok, true)
  assert.equal(result.task.claim.session, 'ses_b')
})

test('задача с незакрытым блокером не захватывается', (t) => {
  const store = freshStore(t)
  const blocker = store.createTask({ title: 'Блокер', project: 'AniVella' })
  const task = store.createTask({
    title: 'Зависимая',
    project: 'AniVella',
    blocked_by: [blocker.id],
  })

  const refused = store.claimTask(task.id, sessionA)

  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'blocked')
  assert.deepEqual(refused.blockers, [blocker.id])
})

test('закрытие блокера переводит зависимые в todo', (t) => {
  const store = freshStore(t)
  const blocker = store.createTask({ title: 'Блокер', project: 'AniVella' })
  const task = store.createTask({
    title: 'Зависимая',
    project: 'AniVella',
    blocked_by: [blocker.id],
  })
  store.claimTask(blocker.id, sessionA)

  store.doneTask(blocker.id, { ...sessionA, note: 'готово' })

  assert.equal(store.getTask(blocker.id).status, 'done')
  assert.equal(store.getTask(task.id).status, 'todo')
})

test('список задач отдаёт активную аренду', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, sessionA)

  const listed = store.listTasks()

  assert.equal(listed.length, 1)
  assert.equal(listed[0].claim.session, 'ses_a')
  assert.ok(listed[0].claim.lease_until)
})

test('чужой не может освободить чужую задачу', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.claimTask(task.id, sessionA)

  const result = store.releaseTask(task.id, sessionB)

  assert.equal(result.ok, false)
  assert.equal(result.code, 'not_owner')
  assert.equal(store.getTask(task.id).claim.session, 'ses_a')
})