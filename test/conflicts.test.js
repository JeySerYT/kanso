import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizePath, pathsOverlap, detectConflict } from '../src/conflicts.js'

test('пути нормализуются одинаково', () => {
  assert.equal(normalizePath('./src/app.js'), 'src/app.js')
  assert.equal(normalizePath('src//app.js/'), 'src/app.js')
  assert.equal(normalizePath('/repo/src/app.js'), 'repo/src/app.js')
})

test('тот же путь считается совпадением', () => {
  assert.deepEqual(pathsOverlap(['src/app.js'], ['src/app.js']), {
    same: 'src/app.js',
    nested: null,
  })
})

test('каталог и файл внутри — пересечение', () => {
  assert.deepEqual(pathsOverlap(['src/components'], ['src/components/Hero.tsx']), {
    same: null,
    nested: ['src/components', 'src/components/Hero.tsx'],
  })
})

test('соседние пути не пересекаются', () => {
  assert.deepEqual(pathsOverlap(['src/a.js'], ['src/b.js']), { same: null, nested: null })
  assert.deepEqual(pathsOverlap(['src/app.js'], ['src/app.jsx']), { same: null, nested: null })
})

test('конфликт с чужой активной арендой обнаруживается', () => {
  const conflict = detectConflict({
    session: 'ses_b',
    paths: ['src/app.js'],
    claims: [
      {
        task_id: 'ANI-1',
        session: 'ses_a',
        lease_until: new Date(Date.now() + 60_000).toISOString(),
        touched_paths: ['src/app.js'],
      },
    ],
  })

  assert.equal(conflict.kind, 'same')
  assert.equal(conflict.with.session, 'ses_a')
  assert.equal(conflict.path, 'src/app.js')
})

test('своя же аренда конфликтом не считается', () => {
  const conflict = detectConflict({
    session: 'ses_a',
    paths: ['src/app.js'],
    claims: [
      {
        task_id: 'ANI-1',
        session: 'ses_a',
        lease_until: new Date(Date.now() + 60_000).toISOString(),
        touched_paths: ['src/app.js'],
      },
    ],
  })

  assert.equal(conflict, null)
})

test('просроченная аренда игнорируется', () => {
  const conflict = detectConflict({
    session: 'ses_b',
    paths: ['src/app.js'],
    claims: [
      {
        task_id: 'ANI-1',
        session: 'ses_a',
        lease_until: new Date(Date.now() - 1000).toISOString(),
        touched_paths: ['src/app.js'],
      },
    ],
  })

  assert.equal(conflict, null)
})