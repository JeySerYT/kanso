import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, join, resolve } from 'node:path'

const SKIP_DIRS = new Set([
  '.cache',
  '.git',
  '.local',
  '.worktrees',
  'AppData',
  'Library',
  'build',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
])

const MAX_DIRS = 12_000
const MAX_REPOS = 200
const GIT_TIMEOUT = 2_000

const defaultRootCandidates = () => {
  const home = homedir()
  return [
    join(home, 'Документы', "Project's"),
    join(home, 'Documents', "Project's"),
    join(home, 'Projects'),
    join(home, 'projects'),
    join(home, 'Developer'),
    join(home, 'code'),
    join(home, 'Code'),
    join(home, 'dev'),
    join(home, 'repos'),
    join(home, 'src'),
    join(home, 'workspace'),
    process.cwd(),
  ]
}

export function defaultRoots(env = process.env) {
  const configured = String(env.KANSO_ROOTS ?? '')
    .split(delimiter)
    .map((root) => root.trim())
    .filter(Boolean)

  const roots = configured.length ? configured : defaultRootCandidates()
  return [...new Set(roots.map((root) => resolve(root)).filter((root) => existsSync(root)))]
}

const isGitRepository = (path) => existsSync(join(path, '.git'))

const git = (path, args) =>
  execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT,
  }).trim()

export function readRepository(path) {
  let currentBranch = ''
  try {
    currentBranch = git(path, ['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch {
    currentBranch = ''
  }

  let branches = []
  try {
    branches = git(path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      .split('\n')
      .map((branch) => branch.trim())
      .filter(Boolean)
  } catch {
    branches = []
  }

  if (currentBranch && !branches.includes(currentBranch)) branches.push(currentBranch)
  branches.sort((a, b) => {
    if (a === currentBranch) return -1
    if (b === currentBranch) return 1
    return a.localeCompare(b)
  })

  return {
    name: basename(path),
    path,
    current_branch: currentBranch,
    branches,
  }
}

export function discoverRepositories({ roots = defaultRoots(), depth = 4 } = {}) {
  const queue = roots.map((root) => ({ dir: resolve(root), level: 0 }))
  const repositories = []
  const seen = new Set()
  let visited = 0

  while (queue.length && repositories.length < MAX_REPOS && visited < MAX_DIRS) {
    const { dir, level } = queue.shift()
    if (seen.has(dir) || !existsSync(dir)) continue
    seen.add(dir)
    visited += 1

    if (level > 0 && isGitRepository(dir)) {
      repositories.push(readRepository(dir))
      continue
    }

    // Корень тоже может быть репозиторием, но внутрь него всё равно не идём.
    if (isGitRepository(dir)) {
      if (!repositories.some((repo) => repo.path === dir)) repositories.push(readRepository(dir))
      continue
    }

    if (level >= depth) continue

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    const children = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name))
      .map((entry) => ({ dir: join(dir, entry.name), level: level + 1 }))
      .sort((a, b) => a.dir.localeCompare(b.dir))

    queue.push(...children)
  }

  return repositories.sort((a, b) => a.name.localeCompare(b.name))
}

export function createProjectIndex({ roots, ttl = 15_000 } = {}) {
  let cache = null
  let scannedAt = 0

  return ({ force = false } = {}) => {
    if (!force && cache && Date.now() - scannedAt < ttl) return cache
    cache = discoverRepositories({ roots: roots ?? defaultRoots() })
    scannedAt = Date.now()
    return cache
  }
}