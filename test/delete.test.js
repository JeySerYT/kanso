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

test('deleteTask удаляет задачу навсегда', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Мусор', project: 'AniVella' })

  const result = store.deleteTask(task.id, { session: 'board' })

  assert.equal(result.ok, true)
  assert.equal(result.id, task.id)
  assert.equal(store.getTask(task.id), null)
  assert.deepEqual(store.listTasks(), [])
})

test('удаление несуществующей задачи возвращает not_found', (t) => {
  const store = freshStore(t)

  const result = store.deleteTask('ZZZ-9', { session: 'board' })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'not_found')
})

test('чужая активная аренда запрещает удаление', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'В работе', project: 'AniVella' })
  store.claimTask(task.id, { session: 'ses_a', cwd: '/work/a' })

  const result = store.deleteTask(task.id, { session: 'ses_b' })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'leased')
  assert.equal(result.owner.session, 'ses_a')
  assert.ok(store.getTask(task.id))
  assert.equal(store.getTask(task.id).claim.session, 'ses_a')
})

test('просроченная аренда не мешает удалению', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Заброшена', project: 'AniVella' })
  store.claimTask(task.id, { session: 'ses_a', leaseMs: -1000 })

  const result = store.deleteTask(task.id, { session: 'board' })

  assert.equal(result.ok, true)
  assert.equal(store.getTask(task.id), null)
})

test('своя аренда удаляется вместе с задачей', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Моя', project: 'AniVella' })
  store.claimTask(task.id, { session: 'ses_a' })

  const result = store.deleteTask(task.id, { session: 'ses_a' })

  assert.equal(result.ok, true)
  assert.equal(store.getTask(task.id), null)
})

test('комментарии удаляются вместе с задачей', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'С заметками', project: 'AniVella' })
  store.commentTask(task.id, { session: 'ses_a', body: 'заметка' })

  store.deleteTask(task.id, { session: 'board' })

  assert.deepEqual(store.listComments(task.id), [])
})

test('треды задачи удаляются вместе с сообщениями', (t) => {
  const store = freshStore(t)
  const a = store.createTask({ title: 'Оптимизация', project: 'AniVella' })
  const b = store.createTask({ title: 'Дизайн', project: 'AniVella' })
  store.claimTask(a.id, { session: 'ses_a', paths: ['src/components'] })
  store.claimTask(b.id, { session: 'ses_b' })
  const conflict = store.touchTask(b.id, { session: 'ses_b', paths: ['src/components/Hero.tsx'] })
  assert.equal(conflict.code, 'needs_agreement')
  store.replyThread(conflict.thread.id, { session: 'ses_b', proposal: 'take-now', body: 'беру' })

  store.deleteTask(a.id, { session: 'ses_a' })

  assert.deepEqual(store.threadsForTask(b.id), [])
  assert.deepEqual(store.listThreads(), [])
})

test('ссылки на удалённую задачу убираются из blocked_by', (t) => {
  const store = freshStore(t)
  const blocker = store.createTask({ title: 'Блокер', project: 'AniVella' })
  const dependent = store.createTask({
    title: 'Зависимая',
    project: 'AniVella',
    blocked_by: [blocker.id],
  })

  store.deleteTask(blocker.id, { session: 'board' })

  assert.deepEqual(store.getTask(dependent.id).blocked_by, [])
})

test('удаление последнего блокера переводит зависимую в todo', (t) => {
  const store = freshStore(t)
  const blocker = store.createTask({ title: 'Блокер', project: 'AniVella' })
  const dependent = store.createTask({
    title: 'Зависимая',
    project: 'AniVella',
    blocked_by: [blocker.id],
  })

  store.deleteTask(blocker.id, { session: 'board' })

  assert.equal(store.getTask(dependent.id).status, 'todo')
})

test('удаление одного из блокеров не разблокирует зависимую', (t) => {
  const store = freshStore(t)
  const first = store.createTask({ title: 'Первый', project: 'AniVella' })
  const second = store.createTask({ title: 'Второй', project: 'AniVella' })
  const dependent = store.createTask({
    title: 'Зависимая',
    project: 'AniVella',
    blocked_by: [first.id, second.id],
  })

  store.deleteTask(first.id, { session: 'board' })

  const after = store.getTask(dependent.id)
  assert.equal(after.status, 'backlog')
  assert.deepEqual(after.blocked_by, [second.id])
})