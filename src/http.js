import { createServer as createHttpServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { openStore } from './store.js'
import { sendPrompt } from './opencode-client.js'
import { createProjectIndex, defaultRoots } from './git.js'
import { resolveLocale, translator } from './i18n.js'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)))
const WEB_ROOT = join(ROOT, 'web')
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const MAX_BODY = 1_000_000

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }))
      }
    })
    req.on('error', reject)
  })

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

const sendError = (res, status, code, extra = {}) =>
  sendJson(res, status, { error: code, ...extra })

const identityOf = (req, body = {}) => ({
  session: body.session || req.headers['x-kanso-session'] || 'board',
  cwd: body.cwd || '',
})

const isStale = (claim) => Boolean(claim && new Date(claim.lease_until) <= new Date())

export async function startServer({
  port = 7777,
  host = '127.0.0.1',
  dbPath,
  watchInterval = 1000,
  roots,
} = {}) {
  const store = openStore(dbPath)
  const t = translator(resolveLocale())
  const projects = createProjectIndex({ roots: roots ?? defaultRoots() })
  const clients = new Set()
  let revision = 1
  let knownDataVersion = store.dataVersion()

  const broadcast = (type, payload = {}) => {
    revision += 1
    const frame = `event: board\ndata: ${JSON.stringify({ type, revision, ...payload })}\n\n`
    for (const client of clients) {
      try {
        client.write(frame)
      } catch {
        clients.delete(client)
      }
    }
  }

  const watchExternal = () => {
    const version = store.dataVersion()
    if (version === knownDataVersion) return
    knownDataVersion = version
    if (clients.size) broadcast('board.synced')
  }
  const watcher = setInterval(watchExternal, watchInterval)
  watcher.unref?.()

  const notifySessions = async (sessions, text) => {
    for (const session of new Set(sessions)) {
      if (!session || session === 'local' || session === 'board') continue
      await sendPrompt(session, text, { delivery: 'queue' })
    }
  }

  const boardPayload = () => {
    const tasks = store.listTasks().map((task) => ({
      ...task,
      stale: isStale(task.claim),
    }))
    return {
      tasks,
      threads: store.listThreads(),
      sessions: store.listSessions(),
      labels: store.listLabels(),
      revision,
      version: VERSION,
    }
  }

  const handleApi = async (req, res, url) => {
    const { pathname, searchParams } = url

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', version: VERSION, revision })
    }

    if (req.method === 'GET' && pathname === '/api/board') {
      return sendJson(res, 200, boardPayload())
    }

    if (req.method === 'GET' && pathname === '/api/labels') {
      return sendJson(res, 200, { labels: store.listLabels() })
    }

    if (req.method === 'POST' && pathname === '/api/labels') {
      const body = await readBody(req)
      const label = store.createLabel(body)
      broadcast('label.created', { name: label.name })
      return sendJson(res, 201, { label })
    }

    if (req.method === 'GET' && pathname === '/api/projects') {
      const discovered = projects({ force: searchParams.get('refresh') === '1' })
      const byName = new Map()
      for (const repository of discovered) byName.set(repository.name, repository)
      for (const name of store.listProjects()) {
        if (!byName.has(name)) {
          byName.set(name, { name, path: '', current_branch: '', branches: [] })
        }
      }
      const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
      return sendJson(res, 200, { projects: list })
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })
      res.write(`retry: 2000\n\n`)
      res.write(`event: board\ndata: ${JSON.stringify({ type: 'hello', revision })}\n\n`)
      clients.add(res)
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000)
      req.on('close', () => {
        clearInterval(heartbeat)
        clients.delete(res)
      })
      return
    }

    if (req.method === 'GET' && pathname === '/api/threads') {
      const state = searchParams.get('state') ?? undefined
      return sendJson(res, 200, { threads: store.listThreads({ state }) })
    }

    if (req.method === 'GET' && pathname === '/api/tasks') {
      const tasks = store.listTasks({
        project: searchParams.get('project') ?? undefined,
        status: searchParams.get('status') ?? undefined,
      })
      return sendJson(res, 200, { tasks })
    }

    if (req.method === 'POST' && pathname === '/api/tasks') {
      const body = await readBody(req)
      if (!body.title || !String(body.title).trim()) {
        return sendError(res, 400, 'title_required')
      }
      const task = store.createTask(body)
      broadcast('task.created', { id: task.id })
      return sendJson(res, 201, { task })
    }

    const threadReply = pathname.match(/^\/api\/threads\/([^/]+)\/reply$/)
    if (threadReply && req.method === 'POST') {
      const body = await readBody(req)
      const who = identityOf(req, body)
      const result = store.replyThread(decodeURIComponent(threadReply[1]), {
        session: who.session,
        proposal: body.proposal,
        body: body.body ?? '',
      })
      if (!result.ok) return sendError(res, result.code === 'not_found' ? 404 : 409, result.code)
      broadcast('thread.replied', { thread: result.thread.id, state: result.state })
      if (result.decision.state === 'needs_decision') {
        const thread = result.thread
        void notifySessions(
          thread.sessions,
          t('server.deadlock', { thread: thread.id, path: thread.path, task: thread.task_a }),
        )
      }
      return sendJson(res, 200, result)
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/([a-z]+))?$/)
    if (taskMatch) {
      const id = decodeURIComponent(taskMatch[1])
      const action = taskMatch[2]
      const task = store.getTask(id)
      if (!task) return sendError(res, 404, 'not_found')

      if (!action && req.method === 'GET') {
        return sendJson(res, 200, {
          task: { ...task, stale: isStale(task.claim) },
          comments: store.listComments(id),
          threads: store.threadsForTask(id),
        })
      }

      if (!action && req.method === 'PATCH') {
        const body = await readBody(req)
        const updated = store.updateTask(id, body)
        broadcast('task.updated', { id })
        return sendJson(res, 200, { task: updated })
      }

      if (!action && req.method === 'DELETE') {
        const body = await readBody(req)
        const who = identityOf(req, body)
        const result = store.deleteTask(id, { session: who.session })
        if (!result.ok) {
          const status = result.code === 'not_found' ? 404 : 409
          return sendError(res, status, result.code, { owner: result.owner })
        }
        broadcast('task.deleted', { id })
        return sendJson(res, 200, { ok: true, id })
      }

      if (!action) return sendError(res, 405, 'method_not_allowed')

      const body = await readBody(req)
      const who = identityOf(req, body)

      if (action === 'move' && req.method === 'POST') {
        if (!body.status) return sendError(res, 400, 'status_required')
        const moved = store.moveTask(id, {
          status: body.status,
          beforeId: body.beforeId,
          session: who.session,
        })
        broadcast('task.moved', { id, status: moved?.status })
        return sendJson(res, 200, { task: moved })
      }

      if (action === 'claim' && req.method === 'POST') {
        const result = store.claimTask(id, {
          session: who.session,
          cwd: who.cwd,
          paths: Array.isArray(body.paths) ? body.paths : [],
        })
        if (!result.ok) {
          const status = result.code === 'locked' ? 423 : result.code === 'not_found' ? 404 : 409
          return sendError(res, status, result.code, {
            owner: result.owner,
            blockers: result.blockers,
          })
        }
        store.touchSession({ id: who.session, cwd: who.cwd })
        broadcast('task.claimed', { id, session: who.session })
        return sendJson(res, 200, { task: result.task })
      }

      if (action === 'touch' && req.method === 'POST') {
        const paths = Array.isArray(body.paths) ? body.paths : []
        const result = store.touchTask(id, { session: who.session, paths })
        if (!result.ok) {
          if (result.code === 'needs_agreement') {
            broadcast('thread.opened', { thread: result.thread.id })
            const text = t('server.conflict', {
              path: result.path,
              task: result.owner.task_id,
              session: result.owner.session,
              thread: result.thread.id,
            })
            void notifySessions([who.session, result.owner.session], text)
          }
          const status = result.code === 'path_locked' ? 409 : 409
          return sendError(res, status, result.code, {
            path: result.path,
            owner: result.owner,
            thread: result.thread,
          })
        }
        broadcast('task.touched', { id })
        return sendJson(res, 200, { task: result.task })
      }

      if (action === 'release' && req.method === 'POST') {
        const result = store.releaseTask(id, { session: who.session, note: body.note ?? '' })
        if (!result.ok) return sendError(res, result.code === 'not_owner' ? 409 : 404, result.code)
        broadcast('task.released', { id })
        return sendJson(res, 200, { task: result.task })
      }

      if (action === 'comment' && req.method === 'POST') {
        if (!body.body || !String(body.body).trim()) return sendError(res, 400, 'body_required')
        const result = store.commentTask(id, {
          session: who.session,
          kind: body.kind ?? 'note',
          body: String(body.body).trim(),
        })
        broadcast('task.commented', { id })
        return sendJson(res, 201, { comment: result.comment })
      }

      return sendError(res, 405, 'method_not_allowed')
    }

    return sendError(res, 404, 'not_found')
  }

  const serveStatic = async (res, pathname) => {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
    const target = normalize(join(WEB_ROOT, relative))
    if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + sep)) {
      return sendError(res, 403, 'forbidden')
    }
    try {
      const file = await readFile(target)
      res.writeHead(200, {
        'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
        'Content-Length': file.length,
        'Cache-Control': 'no-cache',
      })
      res.end(file)
    } catch {
      try {
        const fallback = await readFile(join(WEB_ROOT, 'index.html'))
        res.writeHead(200, {
          'Content-Type': MIME['.html'],
          'Content-Length': fallback.length,
          'Cache-Control': 'no-cache',
        })
        res.end(fallback)
      } catch {
        sendError(res, 404, 'not_found')
      }
    }
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    try {
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
        await handleApi(req, res, url)
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'method_not_allowed')
        return
      }
      await serveStatic(res, url.pathname)
    } catch (error) {
      const status = error.status ?? 500
      sendError(res, status, status === 500 ? 'server_error' : error.message, {
        detail: status === 500 ? String(error) : undefined,
      })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  const address = server.address()
  return {
    port: address.port,
    host,
    store,
    close: () =>
      new Promise((resolve) => {
        clearInterval(watcher)
        for (const client of clients) client.end()
        clients.clear()
        server.close(() => {
          store.close()
          resolve()
        })
      }),
  }
}