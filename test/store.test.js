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

test('созданная задача попадает в backlog с префиксом проекта', (t) => {
  const store = freshStore(t)

  const task = store.createTask({ title: 'Починить шапку', project: 'AniVella' })

  assert.equal(task.id, 'ANI-1')
  assert.equal(task.status, 'backlog')
  assert.equal(task.priority, 2)
  assert.deepEqual(task.labels, [])

  const listed = store.listTasks()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, 'ANI-1')
})

test('счётчик идёт отдельно для каждого проекта', (t) => {
  const store = freshStore(t)

  store.createTask({ title: 'A', project: 'AniVella' })
  store.createTask({ title: 'B', project: 'AniVella' })
  const other = store.createTask({ title: 'C', project: 'Yuzora' })

  assert.equal(other.id, 'YUZ-1')
  assert.deepEqual(
    store.listTasks({ project: 'AniVella' }).map((task) => task.id),
    ['ANI-1', 'ANI-2'],
  )
})

test('список фильтруется по статусу', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Задача', project: 'AniVella' })
  store.moveTask(task.id, 'todo')

  assert.equal(store.listTasks({ status: 'todo' }).length, 1)
  assert.equal(store.listTasks({ status: 'backlog' }).length, 0)
})