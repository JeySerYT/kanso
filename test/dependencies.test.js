import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../src/store.js'

const { startServer } = await import('../src/http.js')

function freshStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-'))
  const store = openStore(join(dir, 'board.db'))
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

test('задача не может блокировать сама себя', (t) => {
  const store = freshStore(t)
  const task = store.createTask({ title: 'Петля', project: 'AniVella' })

  assert.throws(() => store.updateTask(task.id, { blocked_by: [task.id] }), /cycle/)
  assert.deepEqual(store.getTask(task.id).blocked_by, [])
})

test('self-reference отклоняется уже при создании', (t) => {
  const store = freshStore(t)
  const first = store.createTask({ title: 'Первая', project: 'AniVella' })

  // id второй задачи заранее известен по счётчику проекта
  assert.throws(
    () => store.createTask({ title: 'Вторая', project: 'AniVella', blocked_by: ['ANI-2'] }),
    /cycle/,
  )
  assert.equal(store.listTasks().length, 1)
  assert.equal(first.id, 'ANI-1')
  // Отказ не сжигает номер: следующая задача получает ANI-2, а не ANI-3.
  const next = store.createTask({ title: 'Третья', project: 'AniVella' })
  assert.equal(next.id, 'ANI-2')
})

test('прямой цикл A→B→A отклоняется', (t) => {
  const store = freshStore(t)
  const a = store.createTask({ title: 'A', project: 'AniVella' })
  const b = store.createTask({ title: 'B', project: 'AniVella' })
  store.updateTask(a.id, { blocked_by: [b.id] })

  assert.throws(() => store.updateTask(b.id, { blocked_by: [a.id] }), /cycle/)
  assert.deepEqual(store.getTask(b.id).blocked_by, [])
  assert.deepEqual(store.getTask(a.id).blocked_by, [b.id])
})

test('косвенный цикл A→B→C→A отклоняется', (t) => {
  const store = freshStore(t)
  const a = store.createTask({ title: 'A', project: 'AniVella' })
  const b = store.createTask({ title: 'B', project: 'AniVella' })
  const c = store.createTask({ title: 'C', project: 'AniVella' })
  store.updateTask(a.id, { blocked_by: [b.id] })
  store.updateTask(b.id, { blocked_by: [c.id] })

  assert.throws(() => store.updateTask(c.id, { blocked_by: [a.id] }), /cycle/)
  assert.deepEqual(store.getTask(c.id).blocked_by, [])
})

test('цепочка без цикла сохраняется', (t) => {
  const store = freshStore(t)
  const a = store.createTask({ title: 'A', project: 'AniVella' })
  const b = store.createTask({ title: 'B', project: 'AniVella' })
  const c = store.createTask({ title: 'C', project: 'AniVella' })

  store.updateTask(a.id, { blocked_by: [b.id] })
  store.updateTask(b.id, { blocked_by: [c.id] })

  assert.deepEqual(store.getTask(a.id).blocked_by, [b.id])
  assert.deepEqual(store.getTask(b.id).blocked_by, [c.id])
})

test('blocked_by нормализуется: дубликаты и пробелы убираются', (t) => {
  const store = freshStore(t)
  const a = store.createTask({ title: 'A', project: 'AniVella' })
  const b = store.createTask({ title: 'B', project: 'AniVella' })

  const updated = store.updateTask(a.id, { blocked_by: [b.id, b.id, ` ${b.id} `, ''] })

  assert.deepEqual(updated.blocked_by, [b.id])
})

test('HTTP PATCH с циклом отдаёт 400 cycle', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-dep-'))
  const handle = await startServer({ port: 0, dbPath: join(dir, 'board.db'), roots: [] })
  t.after(async () => {
    await handle.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${handle.port}`
  const call = async (path, body) => {
    const response = await fetch(base + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }
  await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'A', project: 'AniVella' }),
  })
  await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'B', project: 'AniVella' }),
  })
  await call('/api/tasks/ANI-1', { blocked_by: ['ANI-2'] })

  const refused = await call('/api/tasks/ANI-2', { blocked_by: ['ANI-1'] })

  assert.equal(refused.status, 400)
  assert.equal(refused.body.error, 'cycle')
})