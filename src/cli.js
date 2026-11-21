import { homedir } from 'node:os'
import { join } from 'node:path'

import { openStore } from './store.js'
import { normalizePath } from './conflicts.js'

const DEFAULT_DB = join(homedir(), '.local/share/kanso/board.db')

const parseArgs = (argv) => {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item.startsWith('--')) {
      const key = item.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i += 1
      } else {
        flags[key] = true
      }
    } else {
      positional.push(item)
    }
  }
  return { flags, positional }
}

const splitList = (value) =>
  String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

const formatTask = (task) => {
  const owner = task.claim ? ` @${task.claim.session.slice(0, 14)}` : ''
  const labels = task.labels.length ? ` [${task.labels.join(',')}]` : ''
  const stale = task.claim && new Date(task.claim.lease_until) < new Date() ? ' (stale)' : ''
  return `${task.id}  ${task.status.padEnd(11)} p${task.priority}  ${task.project.padEnd(10)} ${task.title}${owner}${stale}${labels}`
}

const formatThread = (thread) =>
  `${thread.id}  ${thread.state.padEnd(14)} ${thread.path}  ${thread.task_a}/${thread.task_b}`

const identity = (flags) => ({
  session: flags.session || process.env.OPENCODE_SESSION_ID || 'local',
  cwd: process.cwd(),
})

const openDb = (flags) => openStore(flags.db || process.env.KANSO_DB || DEFAULT_DB)

const withStore = (flags, fn) => {
  const store = openDb(flags)
  try {
    return fn(store)
  } finally {
    store.close()
  }
}

const commands = {
  whoami(flags) {
    const { session, cwd } = identity(flags)
    return withStore(flags, (store) => {
      store.touchSession({ id: session, cwd })
      const mine = store.listTasks({ status: 'in_progress' }).filter((task) => task.claim?.session === session)
      const lines = [`session ${session}`, `cwd ${cwd}`]
      for (const task of mine) lines.push(`holds ${task.id} ${task.title}`)
      if (!mine.length) lines.push('holds nothing')
      return lines.join('\n')
    })
  },

  list(flags) {
    return withStore(flags, (store) => {
      const tasks = store.listTasks({ project: flags.project, status: flags.status })
      if (!tasks.length) return 'no tasks'
      return tasks.map(formatTask).join('\n')
    })
  },

  new(flags, positional) {
    const title = positional.join(' ').trim()
    if (!title) throw new Error('usage: kanso new "title" [--project P]')
    return withStore(flags, (store) => {
      const task = store.createTask({
        title,
        body: typeof flags.body === 'string' ? flags.body : '',
        project: typeof flags.project === 'string' ? flags.project : 'Inbox',
        priority: flags.priority ? Number(flags.priority) : 2,
        labels: splitList(flags.label),
        blocked_by: splitList(flags['blocked-by']),
      })
      return `created ${task.id} ${task.title}`
    })
  },

  get(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error('usage: kanso get ANI-1')
    return withStore(flags, (store) => {
      const task = store.getTask(id)
      if (!task) return `not found ${id}`
      const lines = [formatTask(task)]
      if (task.body) lines.push('', task.body)
      if (task.blocked_by.length) lines.push(`blocked by ${task.blocked_by.join(', ')}`)
      if (task.claim) {
        lines.push(
          `owner ${task.claim.session} (${task.claim.cwd}) lease ${task.claim.lease_until}`,
          `paths ${task.claim.touched_paths.join(', ') || '—'}`,
        )
      }
      for (const thread of store.threadsForTask(id)) lines.push(`thread ${formatThread(thread)}`)
      return lines.join('\n')
    })
  },

  claim(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error('usage: kanso claim ANI-1 [--paths a,b]')
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.claimTask(id, { ...who, paths: splitList(flags.paths) })
      if (!result.ok) {
        if (result.code === 'locked') return `locked by ${result.owner.session} until ${result.owner.lease_until}`
        if (result.code === 'blocked') return `blocked by ${result.blockers.join(', ')}`
        return `${result.code} ${id}`
      }
      store.touchSession({ id: who.session, cwd: who.cwd })
      return `claimed ${id} ${result.task.title}`
    })
  },

  touch(flags, positional) {
    const id = positional[0]
    const paths = positional.slice(1).length ? positional.slice(1) : splitList(flags.paths)
    if (!id || !paths.length) throw new Error('usage: kanso touch ANI-1 src/app.js src/ui.js')
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.touchTask(id, { ...who, paths: paths.map(normalizePath) })
      if (result.ok) return `paths ${result.task.claim.touched_paths.join(', ')}`
      if (result.code === 'path_locked') {
        return `path_locked ${result.path} by ${result.owner.task_id} @${result.owner.session}\nchoose another task or wait for release`
      }
      if (result.code === 'needs_agreement') {
        return `needs_agreement ${result.thread.id} ${result.path}\nask ${result.owner.session} with: kanso reply ${result.thread.id} take-now|wait|split|escalate`
      }
      return `${result.code} ${id}`
    })
  },

  move(flags, positional) {
    const [id, status] = positional
    if (!id || !status) throw new Error('usage: kanso move ANI-1 in_progress')
    const who = identity(flags)
    return withStore(flags, (store) => {
      const task = store.moveTask(id, { status, session: who.session })
      return task ? `moved ${task.id} to ${task.status}` : `not found ${id}`
    })
  },

  comment(flags, positional) {
    const [id, ...rest] = positional
    const body = rest.join(' ').trim() || String(flags.body ?? '').trim()
    if (!id || !body) throw new Error('usage: kanso comment ANI-1 "text"')
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.commentTask(id, { session: who.session, kind: 'note', body })
      return result.ok ? `comment #${result.comment.id} on ${id}` : `not found ${id}`
    })
  },

  release(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error('usage: kanso release ANI-1 --note "state"')
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.releaseTask(id, { ...who, note: String(flags.note ?? '') })
      if (result.ok) return `released ${id}`
      if (result.code === 'not_owner') return `not_owner ${id} held by ${result.owner.session}`
      return `${result.code} ${id}`
    })
  },

  done(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error('usage: kanso done ANI-1 --note "result"')
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.doneTask(id, { ...who, note: String(flags.note ?? '') })
      if (result.ok) return `done ${id}`
      if (result.code === 'not_owner') return `not_owner ${id} held by ${result.owner.session}`
      return `${result.code} ${id}`
    })
  },

  threads(flags) {
    return withStore(flags, (store) => {
      const threads = store.listThreads({ state: flags.state })
      if (!threads.length) return 'no threads'
      return threads
        .map((thread) => {
          const last = thread.messages.at(-1)
          const tail = last ? `  last ${last.from_session} ${last.proposal}` : ''
          return formatThread(thread) + tail
        })
        .join('\n')
    })
  },

  reply(flags, positional) {
    const [threadId, proposal, ...rest] = positional
    if (!threadId || !proposal) {
      throw new Error('usage: kanso reply THR-1 take-now|wait|split|escalate [text]')
    }
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.replyThread(threadId, {
        session: who.session,
        proposal,
        body: rest.join(' '),
      })
      if (!result.ok) return `${result.code} ${threadId}`
      const decision = result.decision
      if (decision.state === 'agreed' && decision.winner) {
        return `agreed ${threadId}: ${decision.winner} takes ${result.thread.path}`
      }
      if (decision.state === 'agreed' && decision.split) {
        return `agreed ${threadId}: split ${result.thread.path}`
      }
      if (decision.state === 'needs_decision') {
        return `needs_decision ${threadId}: ask the human, then kanso comment`
      }
      return `waiting ${threadId}: ${decision.state}`
    })
  },
}

const run = async (argv, { out = console.log } = {}) => {
  const [name, ...rest] = argv
  if (!name || name === 'help' || name === '--help') {
    out('kanso <list|new|get|claim|touch|move|comment|release|done|threads|reply|whoami|serve>')
    return 0
  }
  if (name === 'serve') {
    const { startServer } = await import('./http.js')
    const { flags } = parseArgs(rest)
    const port = Number(flags.port || process.env.KANSO_PORT || 7777)
    const handle = await startServer({ port, dbPath: flags.db || process.env.KANSO_DB || DEFAULT_DB })
    out(`kanso board on http://127.0.0.1:${handle.port}`)
    return 0
  }
  const handler = commands[name]
  if (!handler) {
    out(`unknown command: ${name}`)
    return 2
  }
  const { flags, positional } = parseArgs(rest)
  out(handler(flags, positional))
  return 0
}

export { run, parseArgs }