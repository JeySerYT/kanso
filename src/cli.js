import { homedir } from 'node:os'
import { join } from 'node:path'

import { openStore } from './store.js'
import { normalizePath } from './conflicts.js'
import { resolveLocale, translator } from './i18n.js'

const DEFAULT_DB = join(homedir(), '.local/share/kanso/board.db')
const t = translator(resolveLocale())

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
  const branch = task.branch ? `@${task.branch}` : ''
  const stale = task.claim && new Date(task.claim.lease_until) < new Date() ? ' (stale)' : ''
  return `${task.id}  ${task.status.padEnd(11)} p${task.priority}  ${task.project}${branch}`.padEnd(35) +
    `${task.title}${owner}${stale}${labels}`
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
      const lines = [t('cli.whoamiSession', { session }), t('cli.whoamiCwd', { cwd })]
      for (const task of mine) lines.push(t('cli.holds', { id: task.id, title: task.title }))
      if (!mine.length) lines.push(t('cli.holdsNothing'))
      return lines.join('\n')
    })
  },

  list(flags) {
    return withStore(flags, (store) => {
      const tasks = store.listTasks({ project: flags.project, status: flags.status })
      if (!tasks.length) return t('cli.noTasks')
      return tasks.map(formatTask).join('\n')
    })
  },

  new(flags, positional) {
    const title = positional.join(' ').trim()
    if (!title) throw new Error(t('cli.usage.new'))
    return withStore(flags, (store) => {
      const task = store.createTask({
        title,
        body: typeof flags.body === 'string' ? flags.body : '',
        project: typeof flags.project === 'string' ? flags.project : 'Inbox',
        branch: typeof flags.branch === 'string' ? flags.branch : '',
        priority: flags.priority ? Number(flags.priority) : 2,
        labels: splitList(flags.label),
        blocked_by: splitList(flags['blocked-by']),
      })
      return t('cli.created', { id: task.id, title: task.title })
    })
  },

  get(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error(t('cli.usage.get'))
    return withStore(flags, (store) => {
      const task = store.getTask(id)
      if (!task) return t('cli.notFound', { id })
      const lines = [formatTask(task)]
      if (task.body) lines.push('', task.body)
      if (task.blocked_by.length) lines.push(t('cli.blockedBy', { ids: task.blocked_by.join(', ') }))
      if (task.claim) {
        lines.push(
          t('cli.owner', {
            session: task.claim.session,
            cwd: task.claim.cwd,
            lease: task.claim.lease_until,
          }),
          t('cli.pathsLine', { paths: task.claim.touched_paths.join(', ') || '—' }),
        )
      }
      for (const thread of store.threadsForTask(id)) {
        lines.push(t('cli.thread', { line: formatThread(thread) }))
      }
      return lines.join('\n')
    })
  },

  claim(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error(t('cli.usage.claim'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.claimTask(id, { ...who, paths: splitList(flags.paths) })
      if (!result.ok) {
        if (result.code === 'locked') {
          return t('cli.locked', { session: result.owner.session, lease: result.owner.lease_until })
        }
        if (result.code === 'blocked') {
          return t('cli.blocked', { blockers: result.blockers.join(', ') })
        }
        return t('cli.code', { code: result.code, id })
      }
      store.touchSession({ id: who.session, cwd: who.cwd })
      return t('cli.claimed', { id, title: result.task.title })
    })
  },

  touch(flags, positional) {
    const id = positional[0]
    const paths = positional.slice(1).length ? positional.slice(1) : splitList(flags.paths)
    if (!id || !paths.length) throw new Error(t('cli.usage.touch'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.touchTask(id, { ...who, paths: paths.map(normalizePath) })
      if (result.ok) return t('cli.paths', { paths: result.task.claim.touched_paths.join(', ') })
      if (result.code === 'path_locked') {
        return t('cli.pathLocked', {
          path: result.path,
          task: result.owner.task_id,
          session: result.owner.session,
        })
      }
      if (result.code === 'needs_agreement') {
        return t('cli.needsAgreement', {
          thread: result.thread.id,
          path: result.path,
          session: result.owner.session,
        })
      }
      return t('cli.code', { code: result.code, id })
    })
  },

  move(flags, positional) {
    const [id, status] = positional
    if (!id || !status) throw new Error(t('cli.usage.move'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const task = store.moveTask(id, { status, session: who.session })
      return task ? t('cli.moved', { id: task.id, status: task.status }) : t('cli.notFound', { id })
    })
  },

  comment(flags, positional) {
    const [id, ...rest] = positional
    const body = rest.join(' ').trim() || String(flags.body ?? '').trim()
    if (!id || !body) throw new Error(t('cli.usage.comment'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.commentTask(id, { session: who.session, kind: 'note', body })
      return result.ok
        ? t('cli.comment', { comment: result.comment.id, id })
        : t('cli.notFound', { id })
    })
  },

  release(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error(t('cli.usage.release'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.releaseTask(id, { ...who, note: String(flags.note ?? '') })
      if (result.ok) return t('cli.released', { id })
      if (result.code === 'not_owner') {
        return t('cli.notOwner', { id, session: result.owner.session })
      }
      return t('cli.code', { code: result.code, id })
    })
  },

  done(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error(t('cli.usage.done'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.doneTask(id, { ...who, note: String(flags.note ?? '') })
      if (result.ok) return t('cli.done', { id })
      if (result.code === 'not_owner') {
        return t('cli.notOwner', { id, session: result.owner.session })
      }
      return t('cli.code', { code: result.code, id })
    })
  },

  delete(flags, positional) {
    const id = positional[0]
    if (!id) throw new Error(t('cli.usage.delete'))
    if (flags.yes !== true) throw new Error(t('cli.deleteConfirm', { id }))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.deleteTask(id, { session: who.session })
      if (result.ok) return t('cli.deleted', { id })
      if (result.code === 'leased') return t('cli.leased', { id, session: result.owner.session })
      if (result.code === 'not_found') return t('cli.notFound', { id })
      return t('cli.code', { code: result.code, id })
    })
  },

  threads(flags) {
    return withStore(flags, (store) => {
      const threads = store.listThreads({ state: flags.state })
      if (!threads.length) return t('cli.noThreads')
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
    if (!threadId || !proposal) throw new Error(t('cli.usage.reply'))
    const who = identity(flags)
    return withStore(flags, (store) => {
      const result = store.replyThread(threadId, {
        session: who.session,
        proposal,
        body: rest.join(' '),
      })
      if (!result.ok) return t('cli.code', { code: result.code, id: threadId })
      const decision = result.decision
      if (decision.state === 'agreed' && decision.winner) {
        return t('cli.agreedTake', {
          thread: threadId,
          session: decision.winner,
          path: result.thread.path,
        })
      }
      if (decision.state === 'agreed' && decision.split) {
        return t('cli.agreedSplit', { thread: threadId, path: result.thread.path })
      }
      if (decision.state === 'needs_decision') return t('cli.needsDecision', { thread: threadId })
      return t('cli.waiting', { thread: threadId, state: decision.state })
    })
  },
}

const run = async (argv, { out = console.log } = {}) => {
  const [name, ...rest] = argv
  if (!name || name === 'help' || name === '--help') {
    out(t('cli.usage'))
    return 0
  }
  if (name === 'serve') {
    const { startServer } = await import('./http.js')
    const { flags } = parseArgs(rest)
    const port = Number(flags.port || process.env.KANSO_PORT || 7777)
    const roots = typeof flags.roots === 'string'
      ? flags.roots.split(',').map((root) => root.trim()).filter(Boolean)
      : undefined
    const handle = await startServer({
      port,
      roots,
      dbPath: flags.db || process.env.KANSO_DB || DEFAULT_DB,
    })
    out(t('cli.serve', { port: handle.port }))
    return 0
  }
  const handler = commands[name]
  if (!handler) {
    out(t('cli.unknownCommand', { name }))
    return 2
  }
  const { flags, positional } = parseArgs(rest)
  out(handler(flags, positional))
  return 0
}

export { run, parseArgs }