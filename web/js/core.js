import { hasKey, localeTag, t } from '../i18n.js'

export const STATUS_IDS = ['backlog', 'todo', 'in_progress', 'review', 'done']
export const CANCELED = 'canceled'
export const PRIORITY_MAX = 4
export const SORT_MODES = ['manual', 'priority', 'updated', 'created']

export const statusLabel = (id) => t(`status.${id}`)
export const priorityTitle = (priority) => t(`priority.title.p${priority}`)

export const board = document.querySelector('#board')
export const filters = document.querySelector('#filters')
export const projectsSection = document.querySelector('#projects-section')
export const emptyBoard = document.querySelector('#empty-board')
export const search = document.querySelector('#search')
export const versionEl = document.querySelector('#version')
export const connectionEl = document.querySelector('#connection')
export const connectionText = document.querySelector('#connection-text')
export const live = document.querySelector('#live')
export const toastEl = document.querySelector('#toast')
export const toastText = document.querySelector('#toast-text')
export const toastAction = document.querySelector('#toast-action')
export const toastClose = document.querySelector('#toast-close')
export const toolbar = document.querySelector('#toolbar')
export const filterLabel = document.querySelector('#filter-label')
export const filterPriority = document.querySelector('#filter-priority')
export const filterLeased = document.querySelector('#filter-leased')
export const filterReset = document.querySelector('#filter-reset')
export const sortSelect = document.querySelector('#sort-select')
export const densityToggle = document.querySelector('#density-toggle')
export const densityValue = document.querySelector('#density-value')
export const composeDialog = document.querySelector('#compose-dialog')
export const composeForm = document.querySelector('#compose-form')
export const composeProject = document.querySelector('#compose-project')
export const composeBranch = document.querySelector('#compose-branch')
export const composeNewProject = document.querySelector('#compose-new-project')
export const composeNewBranch = document.querySelector('#compose-new-branch')
export const newProjectField = document.querySelector('#new-project-field')
export const newBranchField = document.querySelector('#new-branch-field')
export const labelPicker = document.querySelector('#label-picker')
export const labelName = document.querySelector('#label-name')
export const labelAdd = document.querySelector('#label-add')
export const languageSelect = document.querySelector('#language')
export const taskDialog = document.querySelector('#task-dialog')
export const drawerTitle = document.querySelector('#task-dialog-title')
export const drawerStatus = document.querySelector('#drawer-status')
export const drawerDone = document.querySelector('#drawer-done')
export const drawerCancel = document.querySelector('#drawer-cancel')
export const drawerDelete = document.querySelector('#drawer-delete')
export const deleteDialog = document.querySelector('#delete-dialog')
export const deleteText = document.querySelector('#delete-dialog-text')
export const deleteConfirm = document.querySelector('#delete-confirm')
export const drawerBlockers = document.querySelector('#drawer-blockers')
export const blockerQuery = document.querySelector('#blocker-query')
export const blockerOptions = document.querySelector('#blocker-options')
export const drawerPriority = document.querySelector('#drawer-priority')
export const drawerLabelPicker = document.querySelector('#drawer-label-picker')
export const commentForm = document.querySelector('#comment-form')
export const paletteDialog = document.querySelector('#palette-dialog')
export const paletteQuery = document.querySelector('#palette-query')
export const paletteList = document.querySelector('#palette-list')
export const paletteEmpty = document.querySelector('#palette-empty')
export const helpDialog = document.querySelector('#help-dialog')
export const cardTemplate = document.querySelector('#card-template')
export const newTask = document.querySelector('#new-task')
export const emptyCreate = document.querySelector('#empty-create')
export const paletteOpen = document.querySelector('#palette-open')
export const helpOpen = document.querySelector('#help-open')
export const viewBoard = document.querySelector('#view-board')
export const viewGraph = document.querySelector('#view-graph')
export const graphView = document.querySelector('#graph')
export const graphCanvas = document.querySelector('#graph-canvas')
export const graphTooltip = document.querySelector('#graph-tooltip')
export const graphHint = document.querySelector('#graph-hint')
export const graphEmpty = document.querySelector('#graph-empty')
export const graphReset = document.querySelector('#graph-reset')
export const graphFit = document.querySelector('#graph-fit')
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export const state = {
  tasks: [],
  threads: [],
  sessions: [],
  labels: [],
  projects: [],
  revision: 0,
  version: '',
  query: '',
  project: 'all',
  label: '',
  priority: '',
  leased: false,
  sort: 'manual',
  density: 'comfortable',
  view: 'board',
}

export const collator = () => new Intl.Collator(localeTag(), { sensitivity: 'base' })

export const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Настройка не сохранится, но интерфейс продолжит работать.
    }
  },
}

export const api = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error ?? `http_${response.status}`)
    error.code = data.error
    error.payload = data
    throw error
  }
  return data
}

export const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export const option = (value, label) => {
  const node = el('option', null, label)
  node.value = value
  return node
}

export const hueOf = (value) => {
  let hash = 0
  for (const char of String(value ?? '')) hash = (hash * 31 + char.codePointAt(0)) % 360
  return hash
}

export const shortSession = (id) => `@${String(id ?? '').slice(-6)}`

export const labelColor = (name) =>
  state.labels.find((label) => label.name === name)?.color ?? `hsl(${hueOf(name)} 70% 65%)`

export const errorText = (error) => {
  const code = error?.code ?? error?.message ?? 'unknown'
  const key = `error.${code}`
  return hasKey(key) ? t(key) : t('error.unknown', { code })
}

export const announce = (text) => {
  live.textContent = ''
  window.setTimeout(() => {
    live.textContent = text
  }, 40)
}

let toastTimer = 0

export const hideToast = () => {
  window.clearTimeout(toastTimer)
  toastEl.hidden = true
  toastAction.hidden = true
  toastAction.onclick = null
}

// Пока фокус внутри тоста (например, на «Вернуть»), авто-скрытие откладывается.
const dismissToast = () => {
  if (toastEl.contains(document.activeElement)) {
    toastTimer = window.setTimeout(dismissToast, 2000)
    return
  }
  hideToast()
}

export const showToast = (text, { error = false, action = null } = {}) => {
  window.clearTimeout(toastTimer)
  toastText.textContent = text
  toastEl.classList.toggle('is-error', error)
  if (action) {
    toastAction.textContent = action.label
    toastAction.hidden = false
    toastAction.onclick = () => {
      hideToast()
      action.run()
    }
  } else {
    toastAction.hidden = true
    toastAction.onclick = null
  }
  toastEl.hidden = false
  toastTimer = window.setTimeout(dismissToast, action ? 6500 : 4200)
}

export const setConnection = (isLive) => {
  connectionEl.classList.toggle('is-live', isLive)
  connectionEl.classList.toggle('is-down', !isLive)
  connectionText.textContent = t(isLive ? 'connection.live' : 'connection.down')
}

export const leaseLabel = (iso) => {
  const left = new Date(iso).getTime() - Date.now()
  if (left <= 0) return t('lease.expired')
  const minutes = Math.ceil(left / 60_000)
  if (minutes < 60) return t('lease.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  return t('lease.hours', { hours, minutes: minutes % 60 })
}

const pad2 = (value) => String(value).padStart(2, '0')

export const leaseCountdown = (iso) => {
  const left = new Date(iso).getTime() - Date.now()
  if (left <= 0) return t('lease.expired')
  const total = Math.floor(left / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours
    ? `T-${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `T-${pad2(minutes)}:${pad2(seconds)}`
}

export const agoLabel = (iso) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  if (diff < 60_000) return t('time.now')
  if (diff < 3_600_000) return t('time.minutesAgo', { minutes: Math.round(diff / 60_000) })
  if (diff < 86_400_000) return t('time.hoursAgo', { hours: Math.round(diff / 3_600_000) })
  return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short' }).format(new Date(iso))
}

export const dateLabel = (iso) =>
  new Intl.DateTimeFormat(localeTag(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

let lastMutation = 0

export const markLocal = () => {
  lastMutation = Date.now()
}

export const msSinceMutation = () => Date.now() - lastMutation

export const taskById = (id) => state.tasks.find((task) => task.id === id)

// Общий фильтр доски и графа: проект, метка, приоритет, аренда, поиск.
export function visibleTask(task) {
  if (state.project !== 'all' && task.project !== state.project) return false
  if (state.label && !task.labels.includes(state.label)) return false
  if (state.priority !== '' && String(task.priority) !== state.priority) return false
  if (state.leased && !task.claim) return false
  if (!state.query) return true
  const needle = state.query.toLowerCase()
  return (
    task.id.toLowerCase().includes(needle) ||
    task.title.toLowerCase().includes(needle) ||
    task.project.toLowerCase().includes(needle) ||
    (task.branch ?? '').toLowerCase().includes(needle) ||
    task.labels.some((label) => label.toLowerCase().includes(needle))
  )
}