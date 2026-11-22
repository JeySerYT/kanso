import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizePath, detectConflict } from './conflicts.js'
import { decideThread, PROPOSALS, MAX_PER_SIDE } from './negotiate.js'

const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'canceled']

const SCHEMA = `
CREATE TABLE IF NOT EXISTS counters (
  project TEXT PRIMARY KEY,
  value   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  project    TEXT NOT NULL,
  branch     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'backlog',
  priority   INTEGER NOT NULL DEFAULT 2,
  position   REAL NOT NULL DEFAULT 0,
  labels     TEXT NOT NULL DEFAULT '[]',
  blocked_by TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at  TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  task_id       TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  session_id    TEXT NOT NULL,
  cwd           TEXT NOT NULL DEFAULT '',
  touched_paths TEXT NOT NULL DEFAULT '[]',
  claimed_at    TEXT NOT NULL,
  lease_until   TEXT NOT NULL,
  heartbeat_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'note',
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id         TEXT PRIMARY KEY,
  task_a     TEXT NOT NULL,
  task_b     TEXT NOT NULL,
  path       TEXT NOT NULL,
  sessions   TEXT NOT NULL DEFAULT '[]',
  state      TEXT NOT NULL DEFAULT 'asked',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id    TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  from_session TEXT NOT NULL,
  proposal     TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  cwd          TEXT NOT NULL DEFAULT '',
  agent        TEXT NOT NULL DEFAULT '',
  started_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  name       TEXT PRIMARY KEY,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status, seq);
CREATE INDEX IF NOT EXISTS comments_task ON comments(task_id, id);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
`

const now = () => new Date().toISOString()

const prefixFor = (project) => {
  const letters = String(project)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
  return (letters.slice(0, 3) || 'TSK').padEnd(3, 'X')
}

const parseJson = (value, fallback) => {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

const hydrate = (row) => {
  if (!row) return null
  return {
    ...row,
    labels: parseJson(row.labels, []),
    blocked_by: parseJson(row.blocked_by, []),
    priority: Number(row.priority),
    position: Number(row.position ?? 0),
    seq: Number(row.seq),
  }
}

const hydrateClaim = (claim) =>
  claim
    ? {
        ...claim,
        session: claim.session_id,
        touched_paths: parseJson(claim.touched_paths, []),
      }
    : null

const LEASE_MS = 15 * 60 * 1000

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  // busy_timeout до journal_mode: иначе параллельный старт двух процессов
  // (например, TUI-плагин и LAN-listener) падает с «database is locked».
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

  // Старые базы без position: добавляем колонку, порядок остаётся по seq.
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name)
  if (!taskColumns.includes('position')) {
    db.exec('ALTER TABLE tasks ADD COLUMN position REAL NOT NULL DEFAULT 0')
  }
  if (!taskColumns.includes('branch')) {
    db.exec("ALTER TABLE tasks ADD COLUMN branch TEXT NOT NULL DEFAULT ''")
  }

  const badRequest = (code) => Object.assign(new Error(code), { status: 400 })

  const normalizePriority = (value, fallback = 2) => {
    const priority = value === undefined || value === null || value === '' ? fallback : Number(value)
    if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
      throw badRequest('priority_out_of_range')
    }
    return priority
  }

  const normalizeLabels = (labels) => {
    if (!Array.isArray(labels)) return []
    return [...new Set(labels.map((label) => String(label).trim()).filter(Boolean))]
  }

  const LABEL_PALETTE = [
    '#b3a1ff',
    '#8ec8ff',
    '#96e6b3',
    '#f6c978',
    '#ff9b9b',
    '#7ee0d8',
    '#e0a1ff',
    '#c6f56d',
  ]

  const autoLabelColor = (name) => {
    let hash = 0
    for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) % 360
    return LABEL_PALETTE[hash % LABEL_PALETTE.length]
  }

  const listLabels = () =>
    db.prepare('SELECT name, color, created_at FROM labels ORDER BY name COLLATE NOCASE').all()

  const createLabel = ({ name, color } = {}) => {
    const label = String(name ?? '').trim()
    if (!label) throw badRequest('label_name_required')
    if (label.length > 32) throw badRequest('label_too_long')
    const value = String(color ?? '')
    const resolved = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : autoLabelColor(label)
    db.prepare(
      'INSERT INTO labels (name, color, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING',
    ).run(label, resolved, now())
    return db.prepare('SELECT name, color, created_at FROM labels WHERE name = ?').get(label)
  }

  const listProjects = () =>
    db
      .prepare('SELECT DISTINCT project FROM tasks ORDER BY project COLLATE NOCASE')
      .all()
      .map((row) => row.project)

  const nextId = (project) => {
    const prefix = prefixFor(project)
    const current = db
      .prepare('SELECT value FROM counters WHERE project = ?')
      .get(project)
    const value = current ? Number(current.value) + 1 : 1
    db.prepare(
      'INSERT INTO counters (project, value) VALUES (?, ?) ' +
        'ON CONFLICT(project) DO UPDATE SET value = excluded.value',
    ).run(project, value)
    return `${prefix}-${value}`
  }

  const nextPosition = (status) => {
    const row = db.prepare('SELECT MAX(position) AS value FROM tasks WHERE status = ?').get(status)
    return Number(row?.value ?? 0) + 1024
  }

  const positionBefore = (status, beforeId) => {
    if (!beforeId) return nextPosition(status)
    const before = db.prepare('SELECT position FROM tasks WHERE id = ?').get(beforeId)
    if (!before) return nextPosition(status)
    const previous = db
      .prepare('SELECT position FROM tasks WHERE status = ? AND position < ? ORDER BY position DESC LIMIT 1')
      .get(status, before.position)
    if (!previous) return Number(before.position) - 1024
    return (Number(previous.position) + Number(before.position)) / 2
  }

  const createTask = ({
    title,
    body = '',
    project = 'Inbox',
    branch = '',
    priority = 2,
    labels = [],
    blocked_by = [],
  }) => {
    if (!title || !String(title).trim()) throw badRequest('title_required')
    const stamp = now()
    const id = nextId(project)
    db.prepare(
      `INSERT INTO tasks (id, title, body, project, branch, status, priority, position, labels, blocked_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(title).trim(),
      String(body),
      String(project),
      String(branch).trim(),
      normalizePriority(priority),
      nextPosition('backlog'),
      JSON.stringify(normalizeLabels(labels)),
      JSON.stringify(normalizeLabels(blocked_by)),
      stamp,
      stamp,
    )
    return getTask(id)
  }

  const getTask = (id) => {
    const task = hydrate(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id))
    if (!task) return null
    task.claim = hydrateClaim(db.prepare('SELECT * FROM claims WHERE task_id = ?').get(id))
    return task
  }

  const listTasks = ({ project, status } = {}) => {
    const where = []
    const params = []
    if (project) {
      where.push('project = ?')
      params.push(project)
    }
    if (status) {
      where.push('status = ?')
      params.push(status)
    }
    const sql =
      'SELECT * FROM tasks' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY position ASC, seq ASC'
    const tasks = db.prepare(sql).all(...params).map(hydrate)
    if (!tasks.length) return tasks

    const placeholders = tasks.map(() => '?').join(',')
    const claims = db
      .prepare(`SELECT * FROM claims WHERE task_id IN (${placeholders})`)
      .all(...tasks.map((task) => task.id))
    const byTask = new Map(claims.map((claim) => [claim.task_id, hydrateClaim(claim)]))
    for (const task of tasks) task.claim = byTask.get(task.id) ?? null
    return tasks
  }

  const moveTask = (id, statusOrOptions = {}) => {
    const options = typeof statusOrOptions === 'string' ? { status: statusOrOptions } : statusOrOptions

    return tx(() => {
      const task = getTask(id)
      if (!task) return null
      const status = options.status ?? task.status
      if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`)

      const stamp = now()
      const position = options.position ?? positionBefore(status, options.beforeId)
      const closedAt = status === 'done' || status === 'canceled' ? stamp : null
      db.prepare(
        'UPDATE tasks SET status = ?, position = ?, updated_at = ?, closed_at = ? WHERE id = ?',
      ).run(status, position, stamp, closedAt, id)

      if (status === 'done' || status === 'canceled') {
        db.prepare('DELETE FROM claims WHERE task_id = ?').run(id)
        if (status === 'done') unblockDependents(id)
      } else {
        renewLease(id, options.session)
      }
      return getTask(id)
    })
  }

  const updateTask = (id, patch = {}) => {
    const task = getTask(id)
    if (!task) return null

    const fields = []
    const params = []
    if (patch.title !== undefined) {
      fields.push('title = ?')
      params.push(String(patch.title).trim())
    }
    if (patch.body !== undefined) {
      fields.push('body = ?')
      params.push(String(patch.body))
    }
    if (patch.project !== undefined) {
      fields.push('project = ?')
      params.push(String(patch.project))
    }
    if (patch.branch !== undefined) {
      fields.push('branch = ?')
      params.push(String(patch.branch).trim())
    }
    if (patch.priority !== undefined) {
      fields.push('priority = ?')
      params.push(normalizePriority(patch.priority, task.priority))
    }
    if (patch.labels !== undefined) {
      fields.push('labels = ?')
      params.push(JSON.stringify(normalizeLabels(patch.labels)))
    }
    if (patch.blocked_by !== undefined) {
      fields.push('blocked_by = ?')
      params.push(JSON.stringify(patch.blocked_by))
    }
    if (!fields.length) return task

    fields.push('updated_at = ?')
    params.push(now(), id)
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return getTask(id)
  }

  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const renewLease = (taskId, session) => {
    if (!session) return
    const stamp = now()
    db.prepare(
      'UPDATE claims SET lease_until = ?, heartbeat_at = ? WHERE task_id = ? AND session_id = ?',
    ).run(new Date(Date.now() + LEASE_MS).toISOString(), stamp, taskId, session)
  }

  const addComment = (taskId, { session = '', kind = 'note', body = '' } = {}) => {
    const stamp = now()
    const info = db
      .prepare(
        'INSERT INTO comments (task_id, session_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(taskId, session, kind, body, stamp)
    return { id: Number(info.lastInsertRowid), task_id: taskId, session_id: session, kind, body, created_at: stamp }
  }

  const commentTask = (id, payload = {}) => {
    if (!getTask(id)) return { ok: false, code: 'not_found' }
    const comment = addComment(id, payload)
    renewLease(id, payload.session)
    return { ok: true, comment }
  }

  const listComments = (taskId) =>
    db.prepare('SELECT * FROM comments WHERE task_id = ? ORDER BY id ASC').all(taskId)

  const pendingBlockers = (blockedBy) => {
    if (!blockedBy.length) return []
    const placeholders = blockedBy.map(() => '?').join(',')
    return db
      .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders}) AND status != 'done'`)
      .all(...blockedBy)
      .map((row) => row.id)
  }

  const activeLeaseOf = (task, session) => {
    const claim = task.claim
    if (!claim || new Date(claim.lease_until) <= new Date()) return null
    return claim.session_id === session ? null : claim
  }

  const claimTask = (id, { session, cwd = '', paths = [], leaseMs = LEASE_MS } = {}) => {
    if (!session) throw new Error('session is required')

    return tx(() => {
      const task = getTask(id)
      if (!task) return { ok: false, code: 'not_found' }
      if (task.status === 'done' || task.status === 'canceled') return { ok: false, code: 'closed' }

      const blockers = pendingBlockers(task.blocked_by)
      if (blockers.length) return { ok: false, code: 'blocked', blockers }

      const stamp = now()
      const claim = task.claim
      const foreign = activeLeaseOf(task, session)
      if (foreign) {
        return {
          ok: false,
          code: 'locked',
          owner: {
            session: foreign.session_id,
            cwd: foreign.cwd,
            lease_until: foreign.lease_until,
            touched_paths: foreign.touched_paths,
          },
        }
      }

      const leaseUntil = new Date(Date.now() + leaseMs).toISOString()
      db.prepare(
        `INSERT INTO claims (task_id, session_id, cwd, touched_paths, claimed_at, lease_until, heartbeat_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           session_id = excluded.session_id,
           cwd = excluded.cwd,
           touched_paths = excluded.touched_paths,
           claimed_at = excluded.claimed_at,
           lease_until = excluded.lease_until,
           heartbeat_at = excluded.heartbeat_at`,
      ).run(id, session, cwd, JSON.stringify(claim?.touched_paths ?? paths), stamp, leaseUntil, stamp)

      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('in_progress', stamp, id)

      return { ok: true, task: getTask(id) }
    })
  }

  const releaseTask = (id, { session, note = '', body = '' } = {}) => {
    return tx(() => {
      const task = getTask(id)
      if (!task) return { ok: false, code: 'not_found' }
      if (task.claim && task.claim.session_id !== session) {
        return { ok: false, code: 'not_owner', owner: { session: task.claim.session_id } }
      }
      const stamp = now()
      db.prepare('DELETE FROM claims WHERE task_id = ?').run(id)
      db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('todo', stamp, id)
      const comment = note ? addComment(id, { session, kind: 'handoff', body: note || body }) : null
      return { ok: true, task: getTask(id), comment }
    })
  }

  const unblockDependents = (closedId) => {
    const dependents = db
      .prepare("SELECT * FROM tasks WHERE status = 'backlog'")
      .all()
      .map(hydrate)
      .filter((task) => task.blocked_by.includes(closedId))
    for (const task of dependents) {
      if (pendingBlockers(task.blocked_by).length === 0) {
        db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('todo', now(), task.id)
      }
    }
  }

  const touchTask = (id, { session, paths = [], leaseMs = LEASE_MS } = {}) => {
    const incoming = (paths ?? []).map(normalizePath).filter(Boolean)
    if (!incoming.length) return { ok: false, code: 'no_paths' }

    return tx(() => {
      const task = getTask(id)
      if (!task) return { ok: false, code: 'not_found' }
      if (!task.claim) return { ok: false, code: 'not_claimed' }
      if (task.claim.session_id !== session) {
        return { ok: false, code: 'not_owner', owner: { session: task.claim.session_id } }
      }

      const others = db
        .prepare('SELECT * FROM claims WHERE task_id != ?')
        .all(id)
        .filter((claim) => claim.session_id !== session)
        .map((claim) => ({
          ...claim,
          session: claim.session_id,
          touched_paths: JSON.parse(claim.touched_paths || '[]'),
        }))

      const conflict = detectConflict({ session, paths: incoming, claims: others })
      if (conflict) {
        const owner = {
          task_id: conflict.with.task_id,
          session: conflict.with.session_id ?? conflict.with.session,
          touched_paths: conflict.with.touched_paths,
          lease_until: conflict.with.lease_until,
        }
        if (conflict.kind === 'same') {
          return { ok: false, code: 'path_locked', path: conflict.path, owner }
        }
        const thread = ensureThread({
          taskA: id,
          taskB: conflict.with.task_id,
          path: conflict.path,
          sessions: [session, owner.session],
        })
        return { ok: false, code: 'needs_agreement', path: conflict.path, owner, thread }
      }

      const merged = [...new Set([...task.claim.touched_paths.map(normalizePath), ...incoming])]
      const stamp = now()
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString()
      db.prepare(
        'UPDATE claims SET touched_paths = ?, lease_until = ?, heartbeat_at = ? WHERE task_id = ?',
      ).run(JSON.stringify(merged), leaseUntil, stamp, id)

      return { ok: true, task: getTask(id) }
    })
  }

  const ensureThread = ({ taskA, taskB, path, sessions }) => {
    const [a, b] = [taskA, taskB].sort()
    const existing = db
      .prepare(
        "SELECT * FROM threads WHERE task_a = ? AND task_b = ? AND path = ? AND state IN ('asked','agreed')",
      )
      .get(a, b, path)
    if (existing) return { ...existing, sessions: parseJson(existing.sessions, sessions) }

    const current = db.prepare('SELECT value FROM counters WHERE project = ?').get('@threads')
    const value = current ? Number(current.value) + 1 : 1
    db.prepare(
      'INSERT INTO counters (project, value) VALUES (?, ?) ON CONFLICT(project) DO UPDATE SET value = excluded.value',
    ).run('@threads', value)

    const stamp = now()
    const thread = {
      id: `THR-${value}`,
      task_a: a,
      task_b: b,
      path,
      sessions,
      state: 'asked',
      created_at: stamp,
      updated_at: stamp,
    }
    db.prepare(
      'INSERT INTO threads (id, task_a, task_b, path, sessions, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(thread.id, a, b, path, JSON.stringify(sessions), 'asked', stamp, stamp)
    return { ...thread, sessions }
  }

  const doneTask = (id, { session = '', note = '' } = {}) => {
    return tx(() => {
      const task = getTask(id)
      if (!task) return { ok: false, code: 'not_found' }
      if (task.claim && session && task.claim.session_id !== session) {
        return { ok: false, code: 'not_owner', owner: { session: task.claim.session_id } }
      }
      const stamp = now()
      db.prepare('DELETE FROM claims WHERE task_id = ?').run(id)
      db.prepare('UPDATE tasks SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?').run(
        'done',
        stamp,
        stamp,
        id,
      )
      if (note) addComment(id, { session, kind: 'decision', body: note })
      unblockDependents(id)
      return { ok: true, task: getTask(id) }
    })
  }

  const deleteTask = (id, { session } = {}) => {
    return tx(() => {
      const task = getTask(id)
      if (!task) return { ok: false, code: 'not_found' }
      const foreign = activeLeaseOf(task, session)
      if (foreign) {
        return {
          ok: false,
          code: 'leased',
          owner: { session: foreign.session_id, lease_until: foreign.lease_until },
        }
      }
      // У threads нет FK на tasks: убираем треды задачи явно, сообщения каскадятся за ними.
      db.prepare('DELETE FROM threads WHERE task_a = ? OR task_b = ?').run(id, id)
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      const stamp = now()
      for (const dependent of db.prepare('SELECT * FROM tasks').all().map(hydrate)) {
        if (!dependent.blocked_by.includes(id)) continue
        const remaining = dependent.blocked_by.filter((blocker) => blocker !== id)
        db.prepare('UPDATE tasks SET blocked_by = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(remaining),
          stamp,
          dependent.id,
        )
        if (dependent.status === 'backlog' && pendingBlockers(remaining).length === 0) {
          db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run('todo', stamp, dependent.id)
        }
      }
      return { ok: true, id }
    })
  }

  const threadById = (threadId) => {
    const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId)
    if (!thread) return null
    const messages = db
      .prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC')
      .all(threadId)
    return { ...thread, sessions: parseJson(thread.sessions, []), messages }
  }

  const threadsForTask = (taskId) =>
    db
      .prepare('SELECT * FROM threads WHERE task_a = ? OR task_b = ? ORDER BY id ASC')
      .all(taskId, taskId)
      .map((thread) => threadById(thread.id))

  const replyThread = (threadId, { session, proposal, body = '' } = {}) => {
    const thread = threadById(threadId)
    if (!thread) return { ok: false, code: 'not_found' }
    if (!PROPOSALS.includes(proposal)) return { ok: false, code: 'invalid_proposal' }

    const participants = [thread.sessions ?? [], thread.messages.map((m) => m.from_session)]
      .flat()
      .filter(Boolean)
    const claimA = db.prepare('SELECT session_id FROM claims WHERE task_id = ?').get(thread.task_a)
    const claimB = db.prepare('SELECT session_id FROM claims WHERE task_id = ?').get(thread.task_b)
    const known = new Set([...participants, claimA?.session_id, claimB?.session_id].filter(Boolean))
    if (!known.has(session)) return { ok: false, code: 'not_participant' }

    const mine = thread.messages.filter((message) => message.from_session === session).length
    if (mine >= MAX_PER_SIDE) return { ok: false, code: 'limit' }

    const stamp = now()
    db.prepare(
      'INSERT INTO messages (thread_id, from_session, proposal, body, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(threadId, session, proposal, body, stamp)

    const updated = threadById(threadId)
    const sides = [...new Set([claimA?.session_id, claimB?.session_id, ...updated.messages.map((m) => m.from_session)].filter(Boolean))]
    const decision = decideThread({ sessions: sides, messages: updated.messages })

    const state = decision.state === 'invalid' ? 'asked' : decision.state
    db.prepare('UPDATE threads SET state = ?, updated_at = ? WHERE id = ?').run(state, stamp, threadId)

    return {
      ok: true,
      thread: threadById(threadId),
      decision,
      state,
    }
  }

  const listThreads = ({ state } = {}) =>
    (state
      ? db.prepare('SELECT id FROM threads WHERE state = ? ORDER BY id ASC').all(state)
      : db.prepare('SELECT id FROM threads ORDER BY id ASC').all()
    ).map((row) => threadById(row.id))

  const touchSession = ({ id, cwd = '', agent = '' }) => {
    if (!id) return null
    const stamp = now()
    db.prepare(
      `INSERT INTO sessions (id, cwd, agent, started_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cwd = excluded.cwd, agent = excluded.agent, last_seen_at = excluded.last_seen_at`,
    ).run(id, cwd, agent, stamp, stamp)
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  }

  const listSessions = () =>
    db.prepare('SELECT * FROM sessions ORDER BY last_seen_at DESC').all()

  const dataVersion = () => db.prepare('PRAGMA data_version').get().data_version

  return {
    close: () => db.close(),
    dataVersion,
    createTask,
    getTask,
    listTasks,
    listProjects,
    moveTask,
    updateTask,
    createLabel,
    listLabels,
    claimTask,
    touchTask,
    releaseTask,
    doneTask,
    deleteTask,
    commentTask,
    listComments,
    threadById,
    threadsForTask,
    replyThread,
    listThreads,
    touchSession,
    listSessions,
  }
}