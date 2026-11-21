import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openStore } from '../src/store.js'

function freshStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-labels-'))
  const store = openStore(join(dir, 'board.db'))
  t.after(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return store
}

test('задача хранит ветку и приоритет p0–p4', (t) => {
  const store = freshStore(t)

  const task = store.createTask({
    title: 'Сайдбар',
    project: 'DashBoard',
    branch: 'feat/sidebar',
    priority: 4,
  })

  assert.equal(task.branch, 'feat/sidebar')
  assert.equal(task.priority, 4)

  const updated = store.updateTask(task.id, { branch: 'fix/sidebar', priority: 0 })
  assert.equal(updated.branch, 'fix/sidebar')
  assert.equal(updated.priority, 0)
})

test('приоритет вне диапазона отклоняется', (t) => {
  const store = freshStore(t)

  assert.throws(() => store.createTask({ title: 'x', priority: 5 }), /priority_out_of_range/)
  assert.throws(
    () => store.updateTask(store.createTask({ title: 'y' }).id, { priority: -1 }),
    /priority_out_of_range/,
  )
})

test('метки дедуплицируются и обрезаются', (t) => {
  const store = freshStore(t)

  const task = store.createTask({ title: 'x', labels: [' ui ', 'ui', '', 'api'] })

  assert.deepEqual(task.labels, ['ui', 'api'])
})

test('реестр меток хранит цвет и не перезаписывает существующую метку', (t) => {
  const store = freshStore(t)

  const first = store.createLabel({ name: 'ui', color: '#8ec8ff' })
  assert.equal(first.color, '#8ec8ff')

  const second = store.createLabel({ name: 'ui', color: '#ff0000' })
  assert.equal(second.color, '#8ec8ff')

  const auto = store.createLabel({ name: 'api' })
  assert.match(auto.color, /^#[0-9a-f]{6}$/)

  assert.deepEqual(store.listLabels().map((label) => label.name), ['api', 'ui'])
})

test('реестр меток отклоняет пустое и слишком длинное имя', (t) => {
  const store = freshStore(t)

  assert.throws(() => store.createLabel({ name: '  ' }), /label_name_required/)
  assert.throws(() => store.createLabel({ name: 'x'.repeat(33) }), /label_too_long/)
})

test('listProjects отдаёт проекты задач без повторов', (t) => {
  const store = freshStore(t)

  store.createTask({ title: 'a', project: 'Yuzora' })
  store.createTask({ title: 'b', project: 'DashBoard' })
  store.createTask({ title: 'c', project: 'Yuzora' })

  assert.deepEqual(store.listProjects(), ['DashBoard', 'Yuzora'])
})