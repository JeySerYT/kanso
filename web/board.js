import {
  applyStaticTranslations,
  currentLocale,
  hasKey,
  initI18n,
  localeTag,
  t,
  useLanguage,
} from './i18n.js'

const STATUS_IDS = ['backlog', 'todo', 'in_progress', 'review', 'done']
const CANCELED = 'canceled'
const PRIORITY_MAX = 4
const SORT_MODES = ['manual', 'priority', 'updated', 'created']

const statusLabel = (id) => t(`status.${id}`)
const priorityTitle = (priority) => t(`priority.title.p${priority}`)

const board = document.querySelector('#board')
const filters = document.querySelector('#filters')
const projectsSection = document.querySelector('#projects-section')
const emptyBoard = document.querySelector('#empty-board')
const search = document.querySelector('#search')
const versionEl = document.querySelector('#version')
const connectionEl = document.querySelector('#connection')
const connectionText = document.querySelector('#connection-text')
const live = document.querySelector('#live')
const toastEl = document.querySelector('#toast')
const toastText = document.querySelector('#toast-text')
const toastAction = document.querySelector('#toast-action')
const toastClose = document.querySelector('#toast-close')
const toolbar = document.querySelector('#toolbar')
const filterLabel = document.querySelector('#filter-label')
const filterPriority = document.querySelector('#filter-priority')
const filterLeased = document.querySelector('#filter-leased')
const filterReset = document.querySelector('#filter-reset')
const sortSelect = document.querySelector('#sort-select')
const densityToggle = document.querySelector('#density-toggle')
const densityValue = document.querySelector('#density-value')
const composeDialog = document.querySelector('#compose-dialog')
const composeForm = document.querySelector('#compose-form')
const composeProject = document.querySelector('#compose-project')
const composeBranch = document.querySelector('#compose-branch')
const composeNewProject = document.querySelector('#compose-new-project')
const composeNewBranch = document.querySelector('#compose-new-branch')
const newProjectField = document.querySelector('#new-project-field')
const newBranchField = document.querySelector('#new-branch-field')
const labelPicker = document.querySelector('#label-picker')
const labelName = document.querySelector('#label-name')
const labelAdd = document.querySelector('#label-add')
const languageSelect = document.querySelector('#language')
const taskDialog = document.querySelector('#task-dialog')
const drawerTitle = document.querySelector('#task-dialog-title')
const drawerStatus = document.querySelector('#drawer-status')
const drawerDone = document.querySelector('#drawer-done')
const drawerCancel = document.querySelector('#drawer-cancel')
const drawerDelete = document.querySelector('#drawer-delete')
const deleteDialog = document.querySelector('#delete-dialog')
const deleteText = document.querySelector('#delete-dialog-text')
const deleteConfirm = document.querySelector('#delete-confirm')
const drawerBlockers = document.querySelector('#drawer-blockers')
const blockerQuery = document.querySelector('#blocker-query')
const blockerOptions = document.querySelector('#blocker-options')
const drawerPriority = document.querySelector('#drawer-priority')
const drawerLabelPicker = document.querySelector('#drawer-label-picker')
const commentForm = document.querySelector('#comment-form')
const paletteDialog = document.querySelector('#palette-dialog')
const paletteQuery = document.querySelector('#palette-query')
const paletteList = document.querySelector('#palette-list')
const paletteEmpty = document.querySelector('#palette-empty')
const helpDialog = document.querySelector('#help-dialog')
const cardTemplate = document.querySelector('#card-template')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const state = {
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
}

const columns = new Map()
const composeLabels = new Set()
const collator = () => new Intl.Collator(localeTag(), { sensitivity: 'base' })

let currentTaskId = null
let drag = null
let lastMutation = 0
let refreshTimer = 0
let pendingRefresh = false
let toastTimer = 0
let lastErrorAt = 0
let composeTarget = 'backlog'
let paletteItems = []
let paletteIndex = 0

const storage = {
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

const api = async (path, { method = 'GET', body } = {}) => {
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

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const option = (value, label) => {
  const node = el('option', null, label)
  node.value = value
  return node
}

const hueOf = (value) => {
  let hash = 0
  for (const char of String(value ?? '')) hash = (hash * 31 + char.codePointAt(0)) % 360
  return hash
}

const shortSession = (id) => `@${String(id ?? '').slice(-6)}`

const labelColor = (name) =>
  state.labels.find((label) => label.name === name)?.color ?? `hsl(${hueOf(name)} 70% 65%)`

const errorText = (error) => {
  const code = error?.code ?? error?.message ?? 'unknown'
  const key = `error.${code}`
  return hasKey(key) ? t(key) : t('error.unknown', { code })
}

const announce = (text) => {
  live.textContent = ''
  window.setTimeout(() => {
    live.textContent = text
  }, 40)
}

const hideToast = () => {
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

const showToast = (text, { error = false, action = null } = {}) => {
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

const setConnection = (isLive) => {
  connectionEl.classList.toggle('is-live', isLive)
  connectionEl.classList.toggle('is-down', !isLive)
  connectionText.textContent = t(isLive ? 'connection.live' : 'connection.down')
}

const leaseLabel = (iso) => {
  const left = new Date(iso).getTime() - Date.now()
  if (left <= 0) return t('lease.expired')
  const minutes = Math.ceil(left / 60_000)
  if (minutes < 60) return t('lease.minutes', { minutes })
  const hours = Math.floor(minutes / 60)
  return t('lease.hours', { hours, minutes: minutes % 60 })
}

const pad2 = (value) => String(value).padStart(2, '0')

const leaseCountdown = (iso) => {
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

const agoLabel = (iso) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  if (diff < 60_000) return t('time.now')
  if (diff < 3_600_000) return t('time.minutesAgo', { minutes: Math.round(diff / 60_000) })
  if (diff < 86_400_000) return t('time.hoursAgo', { hours: Math.round(diff / 3_600_000) })
  return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short' }).format(new Date(iso))
}

const dateLabel = (iso) =>
  new Intl.DateTimeFormat(localeTag(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const markLocal = () => {
  lastMutation = Date.now()
}

const taskById = (id) => state.tasks.find((task) => task.id === id)

/* ---------- Загрузка и отрисовка ---------- */

async function loadBoard() {
  try {
    const data = await api('/api/board')
    state.tasks = data.tasks
    state.threads = data.threads
    state.sessions = data.sessions
    state.labels = data.labels ?? []
    state.revision = Math.max(state.revision, data.revision)
    state.version = data.version
    setConnection(true)
    render()
    if (composeDialog.open) renderLabelPicker()
    // Задачу могли удалить в другой вкладке — не оставляем пустой drawer и диалог удаления.
    if (taskDialog.open && currentTaskId && !taskById(currentTaskId)) taskDialog.close()
    if (deleteDialog.open && pendingDeleteId && !taskById(pendingDeleteId)) deleteDialog.close()
    // Блокировки могли поменять в другой вкладке — обновляем чипы, не трогая открытый поиск.
    if (taskDialog.open && currentTaskId) {
      const fresh = taskById(currentTaskId)
      if (fresh && drawerBlockers.dataset.blockedBy !== JSON.stringify(fresh.blocked_by)) {
        renderBlockerChips(fresh)
      }
    }
  } catch {
    if (Date.now() - lastErrorAt > 5000) {
      lastErrorAt = Date.now()
      showToast(t('toast.boardDown'), { error: true })
    }
    setConnection(false)
  }
}

async function loadProjects() {
  try {
    const data = await api('/api/projects')
    state.projects = data.projects ?? []
  } catch {
    // Список репозиториев не критичен: проект можно ввести вручную.
  }
}

function render() {
  versionEl.textContent = state.version ? t('brand.version', { version: state.version }) : '—'
  document.title = state.tasks.length
    ? t('app.titleCount', { count: state.tasks.length })
    : t('app.title')
  if (search.value !== state.query) search.value = state.query

  const empty = state.tasks.length === 0
  emptyBoard.hidden = !empty
  board.hidden = empty
  projectsSection.hidden = empty
  toolbar.hidden = empty

  renderFilters()
  renderToolbar()
  if (!empty) renderColumns()
}

function renderFilters() {
  const projects = [...new Set(state.tasks.map((task) => task.project))].sort((a, b) =>
    collator().compare(a, b),
  )
  const counts = new Map()
  for (const task of state.tasks) counts.set(task.project, (counts.get(task.project) ?? 0) + 1)

  const signature = `${state.project}|${projects.map((p) => `${p}:${counts.get(p)}`).join('|')}`
  if (filters.dataset.signature === signature) return
  filters.dataset.signature = signature

  const focused = filters.contains(document.activeElement)
    ? document.activeElement.dataset.project
    : null

  const fragment = document.createDocumentFragment()
  fragment.append(createChip('all', t('sidebar.all'), state.tasks.length))
  for (const project of projects) {
    fragment.append(createChip(project, project, counts.get(project)))
  }
  filters.replaceChildren(fragment)

  if (focused) {
    filters.querySelector(`[data-project="${CSS.escape(focused)}"]`)?.focus()
  }
}

function createChip(value, label, count) {
  const chip = el('button', 'chip')
  chip.type = 'button'
  chip.dataset.project = value
  chip.setAttribute('aria-pressed', String(state.project === value))
  chip.append(el('span', null, label), el('span', 'chip-count', String(count)))
  chip.addEventListener('click', () => {
    state.project = value
    render()
  })
  return chip
}

function labelNames() {
  const names = new Set(state.labels.map((label) => label.name))
  for (const task of state.tasks) for (const label of task.labels) names.add(label)
  return [...names].sort((a, b) => collator().compare(a, b))
}

function renderToolbar() {
  const names = labelNames()
  const signature = names.join('|')
  if (filterLabel.dataset.signature !== signature) {
    filterLabel.dataset.signature = signature
    filterLabel.replaceChildren(
      option('', t('toolbar.any')),
      ...names.map((name) => option(name, name)),
    )
  }
  filterLabel.value = state.label
  filterPriority.value = state.priority
  filterLeased.setAttribute('aria-pressed', String(state.leased))
  sortSelect.value = state.sort
  const active = Boolean(state.label || state.priority || state.leased || state.query || state.project !== 'all')
  filterReset.hidden = !active
}

function resetFilters() {
  state.project = 'all'
  state.query = ''
  state.label = ''
  state.priority = ''
  state.leased = false
  render()
}

function setSort(mode) {
  state.sort = SORT_MODES.includes(mode) ? mode : 'manual'
  storage.set('kanso.sort', state.sort)
  render()
}

function setDensity(value) {
  state.density = value === 'compact' ? 'compact' : 'comfortable'
  document.body.classList.toggle('density-compact', state.density === 'compact')
  densityToggle.setAttribute('aria-pressed', String(state.density === 'compact'))
  densityValue.textContent = state.density.toUpperCase()
  storage.set('kanso.density', state.density)
}

function visibleTask(task) {
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

function sortTasks(tasks) {
  if (state.sort === 'manual') return tasks
  const list = [...tasks]
  if (state.sort === 'priority') {
    list.sort((a, b) => a.priority - b.priority)
  } else if (state.sort === 'updated') {
    list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  } else if (state.sort === 'created') {
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }
  return list
}

function renderColumns() {
  const grouped = new Map(STATUS_IDS.map((id) => [id, []]))
  grouped.set(CANCELED, [])
  for (const task of state.tasks) {
    if (!visibleTask(task)) continue
    if (!grouped.has(task.status)) grouped.set(task.status, [])
    grouped.get(task.status).push(task)
  }

  const defs = STATUS_IDS.map((id) => ({ id, label: statusLabel(id) }))
  if (grouped.get(CANCELED).length) defs.push({ id: CANCELED, label: statusLabel(CANCELED) })

  // Карточки ищем по всей доске: при переносе они переезжают в другую колонку,
  // а не пересоздаются. Иначе теряется фокус и рвётся view-transition.
  const existing = new Map()
  for (const node of board.querySelectorAll('.card')) existing.set(node.dataset.id, node)

  for (const def of defs) {
    let column = columns.get(def.id)
    if (!column) {
      column = createColumn(def)
      columns.set(def.id, column)
      board.append(column)
    }
    const tasks = sortTasks(grouped.get(def.id) ?? [])
    column.querySelector('.column-count').textContent = String(tasks.length)
    reconcile(column.querySelector('.column-list'), tasks, existing)
  }

  for (const card of existing.values()) card.remove()

  for (const [id, column] of columns) {
    if (!defs.some((def) => def.id === id)) {
      column.remove()
      columns.delete(id)
    }
  }

  const desired = defs.map((def) => columns.get(def.id))
  const current = [...board.children]
  if (current.length !== desired.length || current.some((node, index) => node !== desired[index])) {
    for (const column of desired) board.append(column)
  }
}

function createColumn(def) {
  const column = el('section', 'column')
  column.dataset.status = def.id

  const head = el('header', 'column-head')
  head.append(el('span', 'column-dot'))
  head.append(el('h2', 'column-title', def.label), el('span', 'column-count', '0'))

  const add = el('button', 'column-add', '+')
  add.type = 'button'
  add.setAttribute('aria-label', t('column.add', { status: def.label }))
  add.addEventListener('click', () => openCompose(def.id))
  head.append(add)

  const list = el('div', 'column-list')
  list.dataset.status = def.id
  list.setAttribute('role', 'list')

  column.append(head, list)
  return column
}

function reconcile(list, tasks, existing) {
  for (const empty of list.querySelectorAll('.column-empty')) empty.remove()

  tasks.forEach((task, index) => {
    let card = existing.get(task.id)
    if (card) {
      existing.delete(task.id)
    } else {
      card = createCard(task)
    }
    updateCard(card, task)
    const reference = list.children[index] ?? null
    if (reference !== card) moveNode(list, card, reference)
  })

  if (!tasks.length) {
    const filtered = state.query || state.label || state.priority !== '' || state.leased
    const empty = el(
      'div',
      'column-empty',
      t(filtered ? 'board.nothingFound' : 'board.drop'),
    )
    list.append(empty)
  }
}

function moveNode(parent, node, reference) {
  // moveBefore сохраняет фокус и состояние при переезде между колонками,
  // но работает только с уже подключёнными узлами.
  if (node.isConnected && parent.isConnected && parent.moveBefore) {
    parent.moveBefore(node, reference)
    return
  }
  if (reference && reference.parentElement === parent) parent.insertBefore(node, reference)
  else parent.append(node)
}

function createCard(task) {
  // importNode переводит узел в текущий документ: moveBefore не умеет adopt из template.
  const card = document.importNode(cardTemplate.content.firstElementChild, true)
  card.dataset.id = task.id
  card.setAttribute('role', 'listitem')
  // Одиночный клик открывает drawer с задержкой: dblclick успевает отменить
  // открытие и начать инлайн-переименование. Клавиатурный клик (detail 0) — сразу.
  let openTimer = 0
  card.addEventListener('click', (event) => {
    if (event.target.closest('.card-handle, .card-priority, .card-title-input, .label')) return
    if (event.detail === 1) {
      window.clearTimeout(openTimer)
      openTimer = window.setTimeout(() => openTask(card.dataset.id), 250)
    } else if (event.detail === 0) {
      openTask(card.dataset.id)
    }
  })
  card.querySelector('.card-handle').addEventListener('pointerdown', onPointerDown)
  card.querySelector('.card-handle').addEventListener('keydown', onHandleKeyDown)

  const title = card.querySelector('.card-title')
  title.addEventListener('dblclick', (event) => {
    event.stopPropagation()
    window.clearTimeout(openTimer)
    const current = taskById(card.dataset.id)
    if (current) startTitleEdit(title, current)
  })

  const priority = card.querySelector('.card-priority')
  priority.append(
    ...Array.from({ length: PRIORITY_MAX + 1 }, (_, value) => option(String(value), `p${value}`)),
  )
  priority.addEventListener('click', (event) => event.stopPropagation())
  priority.addEventListener('change', () => changePriority(card.dataset.id, priority))

  return card
}

async function changePriority(id, select) {
  const task = taskById(id)
  if (!task) return
  const value = Number(select.value)
  try {
    markLocal()
    const { task: updated } = await api(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { priority: value },
    })
    Object.assign(task, updated)
    render()
    announce(t('announce.priority', { id, priority: `p${value}` }))
  } catch (error) {
    select.value = String(task.priority)
    showToast(t('toast.priorityFailed', { error: errorText(error) }), { error: true })
  }
}

function labelChip(name, className = 'label') {
  const chip = el('span', className, name)
  chip.style.setProperty('--label-color', labelColor(name))
  return chip
}

function updateCard(card, task) {
  card.dataset.updated = task.updated_at
  card.dataset.priority = String(task.priority)
  card.style.setProperty('--hue', hueOf(task.project))

  card.querySelector('.card-id').textContent = task.id
  const title = card.querySelector('.card-title')
  title.textContent = task.title
  title.setAttribute('aria-label', t('card.open', { id: task.id, title: task.title }))
  title.title = t('card.renameHint')

  const handle = card.querySelector('.card-handle')
  handle.setAttribute('aria-label', t('card.move', { id: task.id }))

  const labels = card.querySelector('.card-labels')
  const chips = task.labels.slice(0, 3).map((label) => {
    const chip = labelChip(label)
    chip.title = t('card.labelFilter', { name: label })
    chip.addEventListener('click', (event) => {
      event.stopPropagation()
      state.label = state.label === label ? '' : label
      render()
    })
    return chip
  })
  if (task.labels.length > 3) {
    chips.push(el('span', 'label label-more', `+${task.labels.length - 3}`))
  }
  labels.replaceChildren(...chips)

  const projectName = card.querySelector('.project-name')
  projectName.textContent = task.project
  card.querySelector('.project-dot').style.setProperty('--hue', hueOf(task.project))

  const branch = card.querySelector('.card-branch')
  branch.hidden = !task.branch
  branch.textContent = task.branch ?? ''
  if (task.branch) branch.title = t('card.branch', { branch: task.branch })

  const priority = card.querySelector('.card-priority')
  priority.value = String(task.priority)
  priority.dataset.priority = String(task.priority)
  priority.title = priorityTitle(task.priority) ?? t('priority.unknown')
  priority.setAttribute('aria-label', t('card.priorityAria', { id: task.id }))

  const owner = card.querySelector('.card-owner')
  const lease = card.querySelector('.card-lease')
  if (task.claim) {
    owner.hidden = false
    owner.title = t('card.owner', { session: task.claim.session })
    owner.querySelector('.owner-avatar').style.setProperty('--owner-hue', hueOf(task.claim.session))
    owner.querySelector('.owner-name').textContent = shortSession(task.claim.session)
    lease.hidden = false
    lease.title = leaseLabel(task.claim.lease_until)
    lease.querySelector('.lease-time').textContent = leaseCountdown(task.claim.lease_until)
    lease.classList.toggle('is-stale', new Date(task.claim.lease_until).getTime() <= Date.now())
  } else {
    owner.hidden = true
    lease.hidden = true
  }
}

/* ---------- Инлайн-переименование ---------- */

function startTitleEdit(anchor, task, { large = false } = {}) {
  const input = el('input', large ? 'card-title-input title-edit-lg' : 'card-title-input')
  input.type = 'text'
  input.value = task.title
  input.setAttribute('aria-label', t('card.renameAria', { id: task.id }))
  anchor.replaceWith(input)
  input.focus()
  input.select()

  let done = false
  const finish = async (save) => {
    if (done) return
    done = true
    const value = input.value.trim()
    input.replaceWith(anchor)
    anchor.textContent = task.title
    if (!save || !value || value === task.title) return
    try {
      markLocal()
      const { task: updated } = await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        body: { title: value },
      })
      Object.assign(task, updated)
      anchor.textContent = task.title
      render()
      announce(t('announce.renamed', { id: task.id }))
    } catch (error) {
      showToast(t('toast.renameFailed', { error: errorText(error) }), { error: true })
    }
  }

  input.addEventListener('click', (event) => event.stopPropagation())
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      void finish(false)
    }
  })
  input.addEventListener('blur', () => void finish(true))
}

/* ---------- Перетаскивание ---------- */

function onPointerDown(event) {
  if (event.button !== 0) return
  const handle = event.target.closest('.card-handle')
  if (!handle) return
  const card = handle.closest('.card')
  if (!card) return

  event.preventDefault()
  const rect = card.getBoundingClientRect()
  const ghost = card.cloneNode(true)
  ghost.classList.add('card-ghost')
  ghost.classList.remove('is-drag-origin')
  ghost.removeAttribute('role')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.left = `${rect.left}px`
  ghost.style.top = `${rect.top}px`
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  ghost.style.viewTransitionName = 'none'
  for (const node of ghost.querySelectorAll('[id]')) node.removeAttribute('id')
  document.body.append(ghost)

  drag = {
    card,
    handle,
    ghost,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    drop: null,
    raf: 0,
  }

  handle.setPointerCapture(event.pointerId)
  card.classList.add('is-drag-origin')
  document.body.classList.add('is-reordering')
  drag.raf = requestAnimationFrame(autoScroll)
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag.lastX = event.clientX
  drag.lastY = event.clientY
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  drag.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.015)`
  updateDrop()
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const { card, drop } = drag
  const taskTitle = card.querySelector('.card-title').textContent
  endDrag()

  if (!drop) return
  const nextCard =
    card.nextElementSibling && card.nextElementSibling.classList.contains('card')
      ? card.nextElementSibling
      : null
  const sameSlot =
    card.parentElement === drop.list && (nextCard?.dataset.id ?? null) === (drop.beforeId ?? null)
  if (sameSlot) return

  applyMove(card, drop.status, drop.beforeId)
  announce(t('announce.moved', { title: taskTitle, status: statusLabel(drop.status) }))
}

function onPointerCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  endDrag()
  announce(t('announce.cancelled'))
}

function endDrag() {
  if (!drag) return
  const { card, ghost, raf } = drag
  cancelAnimationFrame(raf)
  ghost?.remove()
  card?.classList.remove('is-drag-origin')
  document.body.classList.remove('is-reordering')
  clearDropMarker()
  drag = null
  if (pendingRefresh) {
    pendingRefresh = false
    scheduleRefresh()
  }
}

function clearDropMarker() {
  for (const list of board.querySelectorAll('[data-drop]')) {
    list.removeAttribute('data-drop')
    list.style.removeProperty('--drop-x')
    list.style.removeProperty('--drop-y')
    list.style.removeProperty('--drop-w')
  }
  for (const column of board.querySelectorAll('.is-drop-target')) {
    column.classList.remove('is-drop-target')
  }
}

function updateDrop() {
  if (!drag) return
  const hit = document.elementFromPoint(drag.lastX, drag.lastY)
  const column = hit?.closest('.column')
  clearDropMarker()
  drag.drop = null

  if (!column || column.dataset.status === CANCELED) return

  const list = column.querySelector('.column-list')
  const cards = [...list.querySelectorAll(':scope > .card')].filter((node) => node !== drag.card)

  let before = null
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    if (drag.lastY < rect.top + rect.height / 2) {
      before = card
      break
    }
  }

  const nextCard =
    drag.card.nextElementSibling && drag.card.nextElementSibling.classList.contains('card')
      ? drag.card.nextElementSibling
      : null
  const sameSlot =
    drag.card.parentElement === list && (nextCard?.dataset.id ?? null) === (before?.dataset.id ?? null)
  if (sameSlot) return

  drag.drop = { status: column.dataset.status, beforeId: before?.dataset.id ?? null, list }
  column.classList.add('is-drop-target')

  const listRect = list.getBoundingClientRect()
  let lineY
  if (before) {
    lineY = before.getBoundingClientRect().top - 4
  } else if (cards.length) {
    lineY = cards.at(-1).getBoundingClientRect().bottom + 4
  } else {
    lineY = listRect.top + 16
  }

  list.dataset.drop = ''
  list.style.setProperty('--drop-x', `${Math.round(listRect.left + 8)}px`)
  list.style.setProperty('--drop-y', `${Math.round(Math.max(listRect.top, lineY))}px`)
  list.style.setProperty('--drop-w', `${Math.round(Math.max(0, listRect.width - 16))}px`)
}

function autoScroll() {
  if (!drag) return
  const x = drag.lastX
  const y = drag.lastY
  const boardRect = board.getBoundingClientRect()
  const edge = 72
  let dx = 0
  let dy = 0

  if (x < boardRect.left + edge) {
    dx = -Math.min(18, ((boardRect.left + edge - x) / edge) * 18)
  } else if (x > boardRect.right - edge) {
    dx = Math.min(18, ((x - (boardRect.right - edge)) / edge) * 18)
  }

  const hit = document.elementFromPoint(x, y)
  const list = hit?.closest('.column')?.querySelector('.column-list')
  if (list) {
    const rect = list.getBoundingClientRect()
    if (y < rect.top + 56) {
      dy = -Math.min(16, ((rect.top + 56 - y) / 56) * 16)
    } else if (y > rect.bottom - 56) {
      dy = Math.min(16, ((y - (rect.bottom - 56)) / 56) * 16)
    }
  }

  if (dx) board.scrollLeft += dx
  if (dy && list) list.scrollTop += dy
  if (dx || dy) updateDrop()
  drag.raf = requestAnimationFrame(autoScroll)
}

function onHandleKeyDown(event) {
  if (!event.altKey) return
  const key = event.key
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return
  event.preventDefault()

  const handle = event.currentTarget
  const card = handle.closest('.card')
  const list = card.parentElement
  const title = card.querySelector('.card-title').textContent

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const cards = [...list.querySelectorAll(':scope > .card')]
    const index = cards.indexOf(card)
    const swap = key === 'ArrowUp' ? cards[index - 1] : cards[index + 1]
    if (!swap) {
      announce(t('announce.noFurther'))
      return
    }
    const beforeId =
      key === 'ArrowUp' ? swap.dataset.id : swap.nextElementSibling?.dataset.id ?? null
    applyMove(card, list.dataset.status, beforeId, { animate: false })
    announce(
      t('announce.position', {
        title,
        status: statusLabel(list.dataset.status),
        position: key === 'ArrowUp' ? index : index + 2,
      }),
    )
  } else {
    const order = [...board.querySelectorAll('.column')].filter(
      (column) => column.dataset.status !== CANCELED,
    )
    const current = list.closest('.column')
    const next = order[order.indexOf(current) + (key === 'ArrowRight' ? 1 : -1)]
    if (!next) {
      announce(t('announce.noFurther'))
      return
    }
    const targetList = next.querySelector('.column-list')
    const first = targetList.querySelector(':scope > .card')
    applyMove(card, next.dataset.status, first?.dataset.id ?? null, { animate: false })
    announce(t('announce.moved', { title, status: statusLabel(next.dataset.status) }))
  }

  requestAnimationFrame(() => handle.focus({ preventScroll: true }))
}

/* ---------- Перемещение ---------- */

function applyMove(card, status, beforeId, { animate = true } = {}) {
  const targetList = board.querySelector(`.column-list[data-status="${status}"]`)
  if (!targetList) return

  const sourceList = card.parentElement
  const sameColumn = sourceList === targetList
  const task = taskById(card.dataset.id)

  if (task) {
    task.status = status
    const index = state.tasks.indexOf(task)
    state.tasks.splice(index, 1)
    if (beforeId) {
      const at = state.tasks.findIndex((item) => item.id === beforeId)
      state.tasks.splice(at === -1 ? state.tasks.length : at, 0, task)
    } else {
      state.tasks.push(task)
    }
  }

  const update = () => renderColumns()

  if (animate && !reduceMotion.matches) {
    try {
      if (sameColumn && sourceList.startViewTransition) {
        sourceList.startViewTransition(update)
      } else if (document.startViewTransition) {
        document.startViewTransition(update)
      } else {
        update()
      }
    } catch {
      update()
    }
  } else {
    update()
  }

  markLocal()
  api(`/api/tasks/${encodeURIComponent(card.dataset.id)}/move`, {
    method: 'POST',
    body: { status, beforeId },
  })
    .then(({ task: updated }) => {
      if (!task || !updated) return
      Object.assign(task, updated)
    })
    .catch((error) => {
      showToast(t('toast.moveFailed', { error: errorText(error) }), { error: true })
      loadBoard()
    })
}

/* ---------- Карточка задачи ---------- */

async function openTask(id) {
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(id)}`)
    currentTaskId = id
    renderDrawer(data)
    if (!taskDialog.open) taskDialog.showModal()
  } catch (error) {
    showToast(t('toast.openFailed', { error: errorText(error) }), { error: true })
  }
}

function renderDrawer({ task, comments, threads }) {
  document.querySelector('#drawer-id').textContent = task.id
  document.querySelector('#drawer-project').textContent = task.project
  drawerTitle.textContent = task.title
  drawerTitle.title = t('card.renameHint')

  const badges = document.querySelector('#drawer-badges')
  const badgeItems = [
    el('span', 'badge', statusLabel(task.status)),
    el('span', 'badge', `p${task.priority}`),
    el('span', 'badge', task.project),
  ]
  badgeItems[1].dataset.kind = `priority-${task.priority}`
  if (task.branch) badgeItems.push(el('span', 'badge badge-branch', task.branch))
  if (task.claim) {
    const stale = new Date(task.claim.lease_until).getTime() <= Date.now()
    const leaseBadge = el('span', 'badge badge-lease', t(stale ? 'drawer.badge.stale' : 'drawer.badge.claimed'))
    leaseBadge.classList.toggle('is-stale', stale)
    badgeItems.push(leaseBadge)
  }
  for (const label of task.labels) {
    const chip = labelChip(label, 'badge badge-label')
    badgeItems.push(chip)
  }
  badges.replaceChildren(...badgeItems)

  document.querySelector('#drawer-body').textContent = task.body ?? ''

  const meta = document.querySelector('#drawer-meta')
  const entries = [
    [t('drawer.meta.created'), dateLabel(task.created_at), false, ''],
    [t('drawer.meta.updated'), agoLabel(task.updated_at), false, ''],
  ]
  if (task.branch) entries.push([t('drawer.meta.branch'), task.branch, true, ''])
  if (task.claim) {
    const stale = new Date(task.claim.lease_until).getTime() <= Date.now()
    entries.push([t('drawer.meta.owner'), task.claim.session, true, ''])
    entries.push([
      t('drawer.meta.lease'),
      leaseCountdown(task.claim.lease_until),
      true,
      stale ? 'lease-stale' : 'lease-live',
      task.claim.lease_until,
    ])
  }
  if (task.claim?.touched_paths?.length) {
    entries.push([t('drawer.meta.files'), task.claim.touched_paths.join(', '), true, ''])
  }

  meta.replaceChildren(
    ...entries.map(([term, value, mono, className, leaseUntil]) => {
      const block = el('div')
      block.append(el('dt', null, term))
      const dd = el('dd', [mono ? 'mono' : '', className].filter(Boolean).join(' '), value)
      if (leaseUntil) dd.dataset.leaseDd = leaseUntil
      block.append(dd)
      return block
    }),
  )

  drawerStatus.replaceChildren(
    ...[...STATUS_IDS, CANCELED].map((id) => {
      const node = option(id, statusLabel(id))
      node.selected = id === task.status
      return node
    }),
  )
  drawerDone.disabled = task.status === 'done' || task.status === CANCELED
  drawerCancel.disabled = task.status === CANCELED

  drawerPriority.replaceChildren(
    ...Array.from({ length: PRIORITY_MAX + 1 }, (_, value) => {
      const node = option(String(value), t(`priority.option.p${value}`))
      node.selected = value === task.priority
      return node
    }),
  )
  renderDrawerLabels(task)
  renderDrawerBlockers(task)

  const threadSection = document.querySelector('#drawer-threads-section')
  const threadList = document.querySelector('#drawer-threads')
  threadSection.hidden = !threads.length
  threadList.replaceChildren(...threads.map(renderThread))

  document.querySelector('#comment-count').textContent = String(comments.length)
  const commentList = document.querySelector('#drawer-comments')
  if (!comments.length) {
    commentList.replaceChildren(el('p', 'comment-empty', t('drawer.comment.empty')))
  } else {
    commentList.replaceChildren(...comments.map(renderComment))
  }

  commentForm.dataset.taskId = task.id
  commentForm.reset()
}

function renderDrawerLabels(task) {
  if (!state.labels.length) {
    drawerLabelPicker.replaceChildren(el('span', 'label-empty', t('compose.noLabels')))
    return
  }
  drawerLabelPicker.replaceChildren(
    ...state.labels.map((label) => {
      const chip = el('button', 'label-choice', label.name)
      chip.type = 'button'
      chip.style.setProperty('--label-color', label.color)
      chip.setAttribute('aria-pressed', String(task.labels.includes(label.name)))
      chip.addEventListener('click', () => toggleDrawerLabel(task, label.name))
      return chip
    }),
  )
}

async function toggleDrawerLabel(task, name) {
  const labels = task.labels.includes(name)
    ? task.labels.filter((label) => label !== name)
    : [...task.labels, name]
  try {
    markLocal()
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      body: { labels },
    })
    await openTask(task.id)
    loadBoard()
  } catch (error) {
    showToast(t('toast.labelsFailed', { error: errorText(error) }), { error: true })
  }
}

function renderBlockerChips(task) {
  drawerBlockers.dataset.blockedBy = JSON.stringify(task.blocked_by)
  drawerBlockers.replaceChildren(
    ...task.blocked_by.map((id) => {
      const chip = el('span', 'blocker-chip')
      chip.append(el('span', 'mono', id))
      const target = taskById(id)
      if (target) chip.append(el('span', 'blocker-title', target.title))
      const remove = el('button', 'blocker-remove', '×')
      remove.type = 'button'
      remove.setAttribute('aria-label', t('drawer.blockerRemove'))
      remove.addEventListener('click', () => {
        // Берём свежие данные: задачу могли поменять в другой вкладке.
        const fresh = taskById(task.id)
        if (fresh) setBlockers(fresh, fresh.blocked_by.filter((blocker) => blocker !== id))
      })
      chip.append(remove)
      return chip
    }),
  )
}

function renderDrawerBlockers(task) {
  renderBlockerChips(task)
  blockerQuery.value = ''
  blockerOptions.hidden = true
}

function renderBlockerOptions(task) {
  const query = blockerQuery.value.trim().toLowerCase()
  if (!query) {
    blockerOptions.hidden = true
    return
  }
  const matches = state.tasks
    .filter((other) => other.id !== task.id && !task.blocked_by.includes(other.id))
    .filter(
      (other) =>
        other.id.toLowerCase().includes(query) || other.title.toLowerCase().includes(query),
    )
    .slice(0, 6)
  blockerOptions.hidden = false
  blockerOptions.replaceChildren(
    ...(matches.length
      ? matches.map((other) => {
          const row = el('button', 'blocker-option')
          row.type = 'button'
          row.append(el('span', 'mono', other.id), el('span', null, other.title))
          row.addEventListener('click', () => {
            const fresh = taskById(task.id)
            if (fresh && !fresh.blocked_by.includes(other.id)) {
              setBlockers(fresh, [...fresh.blocked_by, other.id])
            }
          })
          return row
        })
      : [el('p', 'blocker-empty', t('drawer.blockerEmpty'))]),
  )
}

async function setBlockers(task, blockedBy) {
  try {
    markLocal()
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      body: { blocked_by: blockedBy },
    })
    await openTask(task.id)
    loadBoard()
  } catch (error) {
    showToast(t('toast.blockersFailed', { error: errorText(error) }), { error: true })
  }
}

function renderThread(thread) {
  const box = el('div', 'thread')
  box.dataset.state = thread.state

  const head = el('div', 'thread-head')
  head.append(
    el('span', null, thread.id),
    el('span', 'thread-state', t(`thread.state.${thread.state}`)),
    el('span', null, `${thread.task_a} × ${thread.task_b}`),
  )
  box.append(head, el('code', 'thread-path', thread.path))

  for (const message of thread.messages) {
    const row = el('div', 'thread-message')
    row.append(
      el('b', null, shortSession(message.from_session)),
      el('span', 'proposal', message.proposal),
      el('span', null, message.body || ''),
    )
    box.append(row)
  }

  if (thread.state === 'needs_decision') {
    box.append(el('p', 'comment-empty', t('drawer.thread.needsDecision')))
  }

  return box
}

function renderComment(comment) {
  const box = el('div', 'comment')
  const head = el('div', 'comment-head')
  head.append(
    el('span', null, comment.session_id ? shortSession(comment.session_id) : t('drawer.comment.board')),
    el('span', 'comment-kind', t(`drawer.kind.${comment.kind}`)),
    el('span', null, agoLabel(comment.created_at)),
  )
  box.append(head, el('div', 'comment-body', comment.body))
  return box
}

async function moveFromDrawer(status) {
  if (!currentTaskId) return
  try {
    markLocal()
    await api(`/api/tasks/${encodeURIComponent(currentTaskId)}/move`, {
      method: 'POST',
      body: { status },
    })
    await loadBoard()
    await openTask(currentTaskId)
  } catch (error) {
    showToast(t('toast.statusFailed', { error: errorText(error) }), { error: true })
  }
}

async function cancelTask() {
  const task = taskById(currentTaskId)
  if (!task || task.status === CANCELED) return
  const previous = task.status
  const id = task.id
  try {
    markLocal()
    await api(`/api/tasks/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: { status: CANCELED },
    })
    taskDialog.close()
    await loadBoard()
    showToast(t('toast.canceled', { id }), {
      action: {
        label: t('toast.undo'),
        run: async () => {
          try {
            markLocal()
            await api(`/api/tasks/${encodeURIComponent(id)}/move`, {
              method: 'POST',
              body: { status: previous },
            })
            await loadBoard()
            showToast(t('toast.restored', { id }))
          } catch (error) {
            showToast(t('toast.statusFailed', { error: errorText(error) }), { error: true })
          }
        },
      },
    })
  } catch (error) {
    showToast(t('toast.statusFailed', { error: errorText(error) }), { error: true })
  }
}

/* ---------- Удаление ---------- */

let pendingDeleteId = null

function requestDelete(id) {
  const task = taskById(id)
  if (!task) return
  pendingDeleteId = id
  deleteText.textContent = t('delete.text', { title: task.title, id: task.id })
  if (!deleteDialog.open) deleteDialog.showModal()
}

async function confirmDelete() {
  const id = pendingDeleteId
  if (!id) return
  try {
    markLocal()
    await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
    deleteDialog.close()
    if (currentTaskId === id) taskDialog.close()
    await loadBoard()
    if (paletteDialog.open) renderPalette()
    showToast(t('toast.deleted', { id }))
    announce(t('toast.deleted', { id }))
  } catch (error) {
    // Задачу уже удалили в другой вкладке — диалогу больше нечего подтверждать.
    if (error.code === 'not_found') {
      deleteDialog.close()
      await loadBoard()
    }
    showToast(t('toast.deleteFailed', { error: errorText(error) }), { error: true })
  }
}

/* ---------- Создание ---------- */

function projectNames() {
  const names = new Set(['Inbox'])
  for (const project of state.projects) names.add(project.name)
  for (const task of state.tasks) names.add(task.project)
  return [...names].filter(Boolean).sort((a, b) => collator().compare(a, b))
}

function projectByName(name) {
  return state.projects.find((project) => project.name === name)
}

function populateComposeProjects(preferred) {
  const names = projectNames()
  const selected =
    names.includes(preferred) ? preferred : names.includes('Inbox') ? 'Inbox' : names[0]

  composeProject.replaceChildren(
    ...names.map((name) => option(name, name)),
    option('__new__', t('compose.newProject')),
  )
  composeProject.value = selected
  syncNewProjectField()
  populateComposeBranches()
}

function populateComposeBranches(preferred = '') {
  const repository = projectByName(composeProject.value)
  const branches = repository?.branches ?? []
  composeBranch.replaceChildren(
    option('', t('compose.noBranch')),
    ...branches.map((branch) =>
      option(branch, branch === repository.current_branch ? `${branch} *` : branch),
    ),
    option('__new__', t('compose.newBranch')),
  )

  const value = preferred && (preferred === '__new__' || branches.includes(preferred))
    ? preferred
    : ''
  composeBranch.value = value
  syncNewBranchField()
}

function syncNewProjectField(focus = false) {
  const isNew = composeProject.value === '__new__'
  newProjectField.hidden = !isNew
  composeNewProject.hidden = !isNew
  if (isNew && focus) requestAnimationFrame(() => composeNewProject.focus())
}

function syncNewBranchField(focus = false) {
  const isNew = composeBranch.value === '__new__'
  newBranchField.hidden = !isNew
  composeNewBranch.hidden = !isNew
  if (isNew && focus) requestAnimationFrame(() => composeNewBranch.focus())
}

function openCompose(status = 'backlog') {
  composeTarget = status
  composeForm.reset()
  composeLabels.clear()
  const preferred = state.project !== 'all' ? state.project : 'Inbox'
  populateComposeProjects(preferred)
  populateComposeBranches()
  renderLabelPicker()
  labelName.value = ''
  composeDialog.showModal()
  requestAnimationFrame(() => composeForm.elements.title.focus())
  void loadProjects().then(() => populateComposeProjects(composeProject.value))
}

function renderLabelPicker() {
  if (!state.labels.length) {
    labelPicker.replaceChildren(el('span', 'label-empty', t('compose.noLabels')))
    return
  }

  labelPicker.replaceChildren(
    ...state.labels.map((label) => {
      const chip = el('button', 'label-choice', label.name)
      chip.type = 'button'
      chip.style.setProperty('--label-color', label.color)
      chip.setAttribute('aria-pressed', String(composeLabels.has(label.name)))
      chip.addEventListener('click', () => {
        if (composeLabels.has(label.name)) composeLabels.delete(label.name)
        else composeLabels.add(label.name)
        chip.setAttribute('aria-pressed', String(composeLabels.has(label.name)))
      })
      return chip
    }),
  )
}

async function addLabel() {
  const name = labelName.value.trim()
  if (!name) {
    showToast(t('toast.labelRequired'), { error: true })
    labelName.focus()
    return
  }

  try {
    const { label } = await api('/api/labels', { method: 'POST', body: { name } })
    if (!state.labels.some((item) => item.name === label.name)) {
      state.labels.push(label)
      state.labels.sort((a, b) => collator().compare(a.name, b.name))
    }
    composeLabels.add(label.name)
    labelName.value = ''
    renderLabelPicker()
    showToast(t('toast.labelCreated', { name: label.name }))
  } catch (error) {
    showToast(t('toast.labelFailed', { error: errorText(error) }), { error: true })
  }
}

async function submitCompose(event) {
  event.preventDefault()
  const form = new FormData(composeForm)
  const title = String(form.get('title') ?? '').trim()
  if (!title) {
    composeForm.elements.title.focus()
    return
  }

  const project =
    composeProject.value === '__new__'
      ? composeNewProject.value.trim()
      : composeProject.value
  if (!project) {
    showToast(t('error.project_required'), { error: true })
    composeNewProject.focus()
    return
  }

  const branch =
    composeBranch.value === '__new__'
      ? composeNewBranch.value.trim()
      : composeBranch.value

  const priorityValue = Number(form.get('priority') ?? 2)
  const priority = Number.isInteger(priorityValue)
    ? Math.min(PRIORITY_MAX, Math.max(0, priorityValue))
    : 2

  try {
    markLocal()
    const created = await api('/api/tasks', {
      method: 'POST',
      body: {
        title,
        body: String(form.get('body') ?? ''),
        project,
        branch,
        priority,
        labels: [...composeLabels],
      },
    })
    composeDialog.close()
    if (composeTarget !== 'backlog') {
      await api(`/api/tasks/${encodeURIComponent(created.task.id)}/move`, {
        method: 'POST',
        body: { status: composeTarget },
      })
    }
    await loadBoard()
    void loadProjects()
    showToast(t('toast.created', { id: created.task.id }))
    announce(t('announce.created', { id: created.task.id }))
  } catch (error) {
    showToast(t('toast.createFailed', { error: errorText(error) }), { error: true })
  }
}

/* ---------- Командная палитра ---------- */

function paletteCommands() {
  const items = [
    { kind: 'action', title: t('palette.newTask'), hint: 'C', run: () => openCompose() },
    { kind: 'action', title: t('palette.search'), hint: '/', run: () => { search.focus(); search.select() } },
    { kind: 'action', title: t('palette.reset'), run: resetFilters },
    { kind: 'action', title: t('palette.density'), run: () => setDensity(state.density === 'compact' ? 'comfortable' : 'compact') },
    { kind: 'action', title: t('palette.leased'), run: () => { state.leased = !state.leased; render() } },
    { kind: 'action', title: t('palette.help'), hint: '?', run: () => helpDialog.showModal() },
  ]
  if (currentTaskId) {
    items.push({ kind: 'action', title: t('palette.deleteTask'), run: () => requestDelete(currentTaskId) })
  }
  for (const lang of ['ru', 'en']) {
    if (lang === currentLocale()) continue
    items.push({
      kind: 'action',
      title: t('palette.language', { language: lang === 'ru' ? 'Русский' : 'English' }),
      run: () => changeLanguage(lang),
    })
  }
  for (const mode of SORT_MODES) {
    items.push({ kind: 'sort', title: t(`sort.${mode}`), run: () => setSort(mode) })
  }
  const projects = [...new Set(state.tasks.map((task) => task.project))].sort((a, b) =>
    collator().compare(a, b),
  )
  for (const project of projects) {
    items.push({ kind: 'project', title: project, run: () => { state.project = project; render() } })
  }
  for (const label of labelNames()) {
    items.push({ kind: 'label', title: label, run: () => { state.label = label; render() } })
  }
  return items
}

function renderPalette() {
  const query = paletteQuery.value.trim().toLowerCase()
  let items = paletteCommands()
  if (query) {
    items = items.filter((item) => item.title.toLowerCase().includes(query))
    const tasks = state.tasks
      .filter(
        (task) =>
          task.id.toLowerCase().includes(query) || task.title.toLowerCase().includes(query),
      )
      .slice(0, 6)
      .map((task) => ({
        kind: 'task',
        title: `${task.id} ${task.title}`,
        run: () => openTask(task.id),
      }))
    items.push(...tasks)
  }

  paletteItems = items
  paletteIndex = 0
  paletteEmpty.hidden = items.length > 0
  paletteList.replaceChildren(
    ...items.map((item, index) => {
      const li = el('li', 'palette-item')
      li.id = `palette-opt-${index}`
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(index === 0))
      li.append(el('span', null, item.title))
      const kind = el('span', 'palette-kind', t(`palette.kind.${item.kind}`))
      if (item.hint) kind.textContent = `${item.hint} · ${kind.textContent}`
      li.append(kind)
      li.addEventListener('click', () => runPalette(index))
      li.addEventListener('mousemove', () => setPaletteIndex(index))
      return li
    }),
  )
  syncPaletteActive()
}

function setPaletteIndex(index) {
  if (!paletteItems.length) return
  paletteIndex = (index + paletteItems.length) % paletteItems.length
  syncPaletteActive()
}

function syncPaletteActive() {
  const nodes = [...paletteList.children]
  nodes.forEach((node, index) => {
    node.setAttribute('aria-selected', String(index === paletteIndex))
  })
  const active = nodes[paletteIndex]
  if (active) {
    active.scrollIntoView({ block: 'nearest' })
    paletteQuery.setAttribute('aria-activedescendant', active.id)
  } else {
    paletteQuery.removeAttribute('aria-activedescendant')
  }
}

function runPalette(index) {
  const item = paletteItems[index]
  if (!item) return
  paletteDialog.close()
  item.run()
}

function openPalette() {
  paletteQuery.value = ''
  renderPalette()
  if (!paletteDialog.open) paletteDialog.showModal()
  paletteQuery.focus()
}

/* ---------- Навигация с клавиатуры ---------- */

function anyDialogOpen() {
  return composeDialog.open || taskDialog.open || paletteDialog.open || helpDialog.open
}

function focusCard(direction) {
  const cols = [...board.querySelectorAll('.column')].map((column) => [
    ...column.querySelectorAll('.card .card-title'),
  ])
  const active = document.activeElement
  let ci = -1
  let ri = -1
  cols.forEach((cards, index) => {
    const row = cards.indexOf(active)
    if (row !== -1) {
      ci = index
      ri = row
    }
  })

  if (ci === -1) {
    const first = cols.find((cards) => cards.length)
    first?.[0]?.focus()
    return
  }

  if (direction === 'up' || direction === 'down') {
    const next = direction === 'up' ? ri - 1 : ri + 1
    cols[ci][Math.max(0, Math.min(cols[ci].length - 1, next))]?.focus()
    return
  }

  const step = direction === 'left' ? -1 : 1
  for (let index = ci + step; index >= 0 && index < cols.length; index += step) {
    if (cols[index].length) {
      cols[index][Math.min(ri, cols[index].length - 1)].focus()
      return
    }
  }
}

/* ---------- Язык ---------- */

async function changeLanguage(next) {
  await useLanguage(next)
  languageSelect.value = currentLocale()
  applyStaticTranslations()
  // applyStaticTranslations возвращает текст соединения к начальному ключу:
  // восстанавливаем фактическое состояние канала.
  setConnection(connectionEl.classList.contains('is-live'))

  columns.clear()
  board.replaceChildren()
  filters.dataset.signature = ''
  filterLabel.dataset.signature = ''
  render()

  if (taskDialog.open && currentTaskId) {
    await openTask(currentTaskId)
  } else if (composeDialog.open) {
    renderLabelPicker()
    populateComposeProjects(composeProject.value)
  }
  if (deleteDialog.open && pendingDeleteId) {
    const task = taskById(pendingDeleteId)
    if (task) deleteText.textContent = t('delete.text', { title: task.title, id: task.id })
  }
  if (paletteDialog.open) renderPalette()
}

/* ---------- События ---------- */

board.addEventListener('pointermove', onPointerMove)
board.addEventListener('pointerup', onPointerUp)
board.addEventListener('pointercancel', onPointerCancel)
board.addEventListener('lostpointercapture', (event) => {
  if (drag && event.pointerId === drag.pointerId) {
    endDrag()
    announce(t('announce.cancelled'))
  }
})

board.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) return
    if (board.scrollWidth <= board.clientWidth + 1) return

    if (event.shiftKey) {
      board.scrollLeft += event.deltaY
      event.preventDefault()
      return
    }

    const list = event.target.closest('.column-list')
    const canScrollList = list && list.scrollHeight > list.clientHeight + 1
    if (canScrollList && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) return

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) return
    board.scrollLeft += delta
    event.preventDefault()
  },
  { passive: false },
)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drag) {
    endDrag()
    announce(t('announce.cancelled'))
  }
})

search.addEventListener('input', () => {
  state.query = search.value.trim()
  render()
})

document.querySelector('#new-task').addEventListener('click', () => openCompose())
document.querySelector('#empty-create').addEventListener('click', () => openCompose())

filterLabel.addEventListener('change', () => {
  state.label = filterLabel.value
  render()
})
filterPriority.addEventListener('change', () => {
  state.priority = filterPriority.value
  render()
})
filterLeased.addEventListener('click', () => {
  state.leased = !state.leased
  render()
})
filterReset.addEventListener('click', resetFilters)
toastClose.addEventListener('click', hideToast)
sortSelect.addEventListener('change', () => setSort(sortSelect.value))
densityToggle.addEventListener('click', () =>
  setDensity(state.density === 'compact' ? 'comfortable' : 'compact'),
)
document.querySelector('#palette-open').addEventListener('click', openPalette)
document.querySelector('#help-open').addEventListener('click', () => helpDialog.showModal())

composeProject.addEventListener('change', () => {
  syncNewProjectField(true)
  populateComposeBranches()
})
composeBranch.addEventListener('change', () => syncNewBranchField(true))
composeForm.addEventListener('submit', submitCompose)
labelAdd.addEventListener('click', addLabel)
labelName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    addLabel()
  }
})
languageSelect.addEventListener('change', () => changeLanguage(languageSelect.value))

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog')?.close())
}

taskDialog.addEventListener('close', () => {
  currentTaskId = null
})

drawerTitle.addEventListener('dblclick', () => {
  const task = taskById(currentTaskId)
  if (task) startTitleEdit(drawerTitle, task, { large: true })
})
drawerStatus.addEventListener('change', () => moveFromDrawer(drawerStatus.value))
blockerQuery.addEventListener('input', () => {
  const task = taskById(currentTaskId)
  if (task) renderBlockerOptions(task)
})
taskDialog.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.blocker-picker')) blockerOptions.hidden = true
})
drawerDone.addEventListener('click', () => moveFromDrawer('done'))
drawerCancel.addEventListener('click', cancelTask)
drawerDelete.addEventListener('click', () => requestDelete(currentTaskId))
deleteConfirm.addEventListener('click', confirmDelete)
deleteDialog.addEventListener('close', () => {
  pendingDeleteId = null
})
drawerPriority.addEventListener('change', async () => {
  const task = taskById(currentTaskId)
  if (!task) return
  try {
    markLocal()
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: 'PATCH',
      body: { priority: Number(drawerPriority.value) },
    })
    await openTask(task.id)
    loadBoard()
  } catch (error) {
    showToast(t('toast.priorityFailed', { error: errorText(error) }), { error: true })
  }
})

commentForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = new FormData(commentForm)
  const body = String(form.get('body') ?? '').trim()
  if (!body || !commentForm.dataset.taskId) return
  try {
    await api(`/api/tasks/${encodeURIComponent(commentForm.dataset.taskId)}/comment`, {
      method: 'POST',
      body: { body, kind: String(form.get('kind') ?? 'note') },
    })
    const id = currentTaskId
    await openTask(id)
    loadBoard()
  } catch (error) {
    showToast(t('toast.commentFailed', { error: errorText(error) }), { error: true })
  }
})

paletteQuery.addEventListener('input', renderPalette)
paletteQuery.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setPaletteIndex(paletteIndex + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    setPaletteIndex(paletteIndex - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    runPalette(paletteIndex)
  }
})

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (paletteDialog.open) paletteDialog.close()
    else openPalette()
    return
  }

  const target = event.target
  const typing =
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return
  if (anyDialogOpen() || drag || board.hidden) return

  const key = event.key
  if (key === '/') {
    event.preventDefault()
    search.focus()
    search.select()
  } else if (key === '?') {
    event.preventDefault()
    helpDialog.showModal()
  } else if (key.toLowerCase() === 'n' || key.toLowerCase() === 'c') {
    event.preventDefault()
    openCompose()
  } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    event.preventDefault()
    focusCard(key.slice(5).toLowerCase())
  } else if (/^[1-5]$/.test(key)) {
    const card = document.activeElement?.closest?.('.card')
    if (!card) return
    event.preventDefault()
    const status = STATUS_IDS[Number(key) - 1]
    applyMove(card, status, null)
    announce(t('announce.moved', { title: taskById(card.dataset.id)?.title ?? card.dataset.id, status: statusLabel(status) }))
  }
})

/* ---------- SSE ---------- */

function scheduleRefresh() {
  if (drag) {
    pendingRefresh = true
    return
  }
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(loadBoard, 120)
}

function connectEvents() {
  if (!('EventSource' in window)) {
    setConnection(false)
    window.setInterval(loadBoard, 5000)
    return
  }

  const source = new EventSource('/api/events')

  source.addEventListener('open', () => setConnection(true))
  source.addEventListener('error', () => setConnection(false))
  source.addEventListener('board', (event) => {
    let payload
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    if (payload.type === 'hello') {
      setConnection(true)
      if (payload.revision < state.revision) {
        state.revision = 0
        scheduleRefresh()
      }
      return
    }
    if (payload.revision <= state.revision) return
    if (Date.now() - lastMutation < 900) {
      state.revision = payload.revision
      return
    }
    scheduleRefresh()
  })
}

/* ---------- Мягкое закрытие по клику вне диалога ---------- */

if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (event, dialog) => {
    const rect = dialog.getBoundingClientRect()
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
  }

  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false
    dialog.addEventListener('pointerdown', (event) => {
      pressedOutside = outside(event, dialog)
    })
    dialog.addEventListener('pointerup', (event) => {
      if (pressedOutside && outside(event, dialog)) dialog.close()
    })
  }
}

/* ---------- Запуск ---------- */

async function boot() {
  await initI18n()
  languageSelect.value = currentLocale()
  applyStaticTranslations()
  state.sort = SORT_MODES.includes(storage.get('kanso.sort', 'manual'))
    ? storage.get('kanso.sort', 'manual')
    : 'manual'
  setDensity(storage.get('kanso.density', 'comfortable'))
  await loadBoard()
  connectEvents()
  void loadProjects()
}

boot()

// Телеметрия аренды: отсчёт обновляется раз в секунду, только текст и классы.
window.setInterval(() => {
  const now = Date.now()
  for (const card of board.querySelectorAll('.card')) {
    const task = taskById(card.dataset.id)
    const lease = card.querySelector('.card-lease')
    if (!task?.claim) {
      lease.hidden = true
      continue
    }
    const stale = new Date(task.claim.lease_until).getTime() <= now
    lease.hidden = false
    lease.classList.toggle('is-stale', stale)
    lease.querySelector('.lease-time').textContent = leaseCountdown(task.claim.lease_until)
  }
  const dd = taskDialog.open ? document.querySelector('[data-lease-dd]') : null
  if (dd) {
    const stale = new Date(dd.dataset.leaseDd).getTime() <= now
    dd.textContent = leaseCountdown(dd.dataset.leaseDd)
    dd.classList.toggle('lease-live', !stale)
    dd.classList.toggle('lease-stale', stale)
  }
}, 1000)

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadBoard()
})