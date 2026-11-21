import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.KANSO_OPENCODE_URL = 'http://127.0.0.1:9'

const { startServer } = await import('../src/http.js')
const { openStore } = await import('../src/store.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()

async function withServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-http-'))
  const handle = await startServer({ port: 0, dbPath: join(dir, 'board.db') })
  const base = `http://127.0.0.1:${handle.port}`
  const call = async (path, options = {}) => {
    const response = await fetch(base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }
  t.after(async () => {
    await handle.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { call, base }
}

test('health отдаёт версию из VERSION', async (t) => {
  const { call } = await withServer(t)

  const { status, body } = await call('/health')

  assert.equal(status, 200)
  assert.equal(body.status, 'ok')
  assert.equal(body.version, version)
})

test('создание задачи возвращает 201 и попадает на доску', async (t) => {
  const { call } = await withServer(t)

  const created = await call('/api/tasks', {
    method: 'POST',
    body: { title: 'Починить шапку', project: 'AniVella' },
  })

  assert.equal(created.status, 201)
  assert.equal(created.body.task.id, 'ANI-1')

  const board = await call('/api/board')
  assert.equal(board.status, 200)
  assert.equal(board.body.tasks.length, 1)
  assert.equal(board.body.tasks[0].status, 'backlog')
})

test('без заголовка задача не создаётся', async (t) => {
  const { call } = await withServer(t)

  const created = await call('/api/tasks', { method: 'POST', body: { title: '  ' } })

  assert.equal(created.status, 400)
  assert.equal(created.body.error, 'title_required')
})

test('move меняет статус и порядок по beforeId', async (t) => {
  const { call } = await withServer(t)
  for (const title of ['Первая', 'Вторая', 'Третья']) {
    await call('/api/tasks', { method: 'POST', body: { title, project: 'AniVella' } })
  }

  const moved = await call('/api/tasks/ANI-3/move', {
    method: 'POST',
    body: { status: 'todo' },
  })
  assert.equal(moved.status, 200)
  assert.equal(moved.body.task.status, 'todo')

  const reordered = await call('/api/tasks/ANI-3/move', {
    method: 'POST',
    body: { status: 'backlog', beforeId: 'ANI-1' },
  })
  assert.equal(reordered.status, 200)

  const board = await call('/api/board')
  assert.deepEqual(
    board.body.tasks.map((task) => task.id),
    ['ANI-3', 'ANI-1', 'ANI-2'],
  )
})

test('второй захват отдаёт 423 и владельца', async (t) => {
  const { call } = await withServer(t)
  await call('/api/tasks', { method: 'POST', body: { title: 'Задача', project: 'AniVella' } })

  const first = await call('/api/tasks/ANI-1/claim', {
    method: 'POST',
    body: { session: 'ses_a' },
  })
  assert.equal(first.status, 200)

  const second = await call('/api/tasks/ANI-1/claim', {
    method: 'POST',
    body: { session: 'ses_b' },
  })
  assert.equal(second.status, 423)
  assert.equal(second.body.error, 'locked')
  assert.equal(second.body.owner.session, 'ses_a')
})

test('комментарий виден в карточке задачи', async (t) => {
  const { call } = await withServer(t)
  await call('/api/tasks', { method: 'POST', body: { title: 'Задача', project: 'AniVella' } })

  const comment = await call('/api/tasks/ANI-1/comment', {
    method: 'POST',
    body: { body: 'ветка feat/header', session: 'ses_a', kind: 'handoff' },
  })
  assert.equal(comment.status, 201)

  const card = await call('/api/tasks/ANI-1')
  assert.equal(card.status, 200)
  assert.equal(card.body.comments.length, 1)
  assert.equal(card.body.comments[0].body, 'ветка feat/header')
})

test('неизвестная задача отдаёт 404', async (t) => {
  const { call } = await withServer(t)

  const card = await call('/api/tasks/ZZZ-9')

  assert.equal(card.status, 404)
})

test('SSE замечает изменения из другого процесса', { timeout: 5000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-http-'))
  const dbPath = join(dir, 'board.db')
  const handle = await startServer({ port: 0, dbPath, watchInterval: 20 })
  const base = `http://127.0.0.1:${handle.port}`
  const controller = new AbortController()
  t.after(async () => {
    controller.abort()
    await handle.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const response = await fetch(`${base}/api/events`, { signal: controller.signal })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const readUntil = async (needle) => {
    while (!buffer.includes(needle)) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
    }
    return buffer.includes(needle)
  }

  assert.equal(await readUntil('"type":"hello"'), true)

  const external = openStore(dbPath)
  external.createTask({ title: 'Из CLI', project: 'AniVella' })
  external.close()

  assert.equal(await readUntil('board.synced'), true)
})

test('доска отдаёт треды после пересечения путей', async (t) => {
  const { call } = await withServer(t)
  await call('/api/tasks', { method: 'POST', body: { title: 'Оптимизация', project: 'AniVella' } })
  await call('/api/tasks', { method: 'POST', body: { title: 'Дизайн', project: 'AniVella' } })
  await call('/api/tasks/ANI-1/claim', {
    method: 'POST',
    body: { session: 'ses_a', paths: ['src/components'] },
  })
  await call('/api/tasks/ANI-2/claim', { method: 'POST', body: { session: 'ses_b' } })

  const touch = await call('/api/tasks/ANI-2/touch', {
    method: 'POST',
    body: { session: 'ses_b', paths: ['src/components/Hero.tsx'] },
  })

  assert.equal(touch.status, 409)
  assert.equal(touch.body.error, 'needs_agreement')
  assert.equal(touch.body.thread.state, 'asked')

  const board = await call('/api/board')
  assert.equal(board.body.threads.length, 1)
  assert.equal(board.body.threads[0].path, 'src/components/Hero.tsx')
})