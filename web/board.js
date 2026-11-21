const STATUSES = [
  { id: 'backlog', label: 'Бэклог' },
  { id: 'todo', label: 'К работе' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'review', label: 'Ревью' },
  { id: 'done', label: 'Готово' },
]

const CANCELED = { id: 'canceled', label: 'Отменено' }

const STATE_LABELS = Object.fromEntries([...STATUSES, CANCELED].map((s) => [s.id, s.label]))

const board = document.querySelector('#board')
const filters = document.querySelector('#filters')
const emptyBoard = document.querySelector('#empty-board')
const search = document.querySelector('#search')
const versionEl = document.querySelector('#version')
const connectionEl = document.querySelector('#connection')
const connectionText = document.querySelector('#connection-text')
const live = document.querySelector('#live')
const toastEl = document.querySelector('#toast')
const composeDialog = document.querySelector('#compose-dialog')
const composeForm = document.querySelector('#compose-form')
const projectsList = document.querySelector('#projects')
const taskDialog = document.querySelector('#task-dialog')
const drawerStatus = document.querySelector('#drawer-status')
const drawerDone = document.querySelector('#drawer-done')
const commentForm = document.querySelector('#comment-form')
const cardTemplate = document.querySelector('#card-template')
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

const state = {
  tasks: [],
  threads: [],
  sessions: [],
  revision: 0,
  version: '',
  query: '',
  project: 'all',
}

const columns = new Map()
let currentTaskId = null
let drag = null
let lastMutation = 0
let refreshTimer = 0
let pendingRefresh = false
let toastTimer = 0
let lastErrorAt = 0
let composeTarget = 'backlog'

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

const hueOf = (value) => {
  let hash = 0
  for (const char of String(value ?? '')) hash = (hash * 31 + char.codePointAt(0)) % 360
  return hash
}

const shortSession = (id) => `@${String(id ?? '').slice(-6)}`

const labelOfStatus = (id) => STATE_LABELS[id] ?? id

const announce = (text) => {
  live.textContent = ''
  window.setTimeout(() => {
    live.textContent = text
  }, 40)
}

const showToast = (text, { error = false } = {}) => {
  window.clearTimeout(toastTimer)
  toastEl.textContent = text
  toastEl.classList.toggle('is-error', error)
  toastEl.hidden = false
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true
  }, 4200)
}

const setConnection = (live) => {
  connectionEl.classList.toggle('is-live', live)
  connectionEl.classList.toggle('is-down', !live)
  connectionText.textContent = live ? 'на связи' : 'переподключение'
}

const leaseLabel = (iso) => {
  const left = new Date(iso).getTime() - Date.now()
  if (left <= 0) return 'аренда истекла'
  const minutes = Math.ceil(left / 60_000)
  if (minutes < 60) return `осталось ${minutes}м`
  const hours = Math.floor(minutes / 60)
  return `осталось ${hours}ч ${minutes % 60}м`
}

const agoLabel = (iso) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}м назад`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}ч назад`
  return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(new Date(iso))
}

const dateLabel = (iso) =>
  new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const markLocal = () => {
  lastMutation = Date.now()
}

/* ---------- Загрузка и отрисовка ---------- */

async function loadBoard() {
  try {
    const data = await api('/api/board')
    state.tasks = data.tasks
    state.threads = data.threads
    state.sessions = data.sessions
    state.revision = Math.max(state.revision, data.revision)
    state.version = data.version
    setConnection(true)
    render()
  } catch (error) {
    if (Date.now() - lastErrorAt > 5000) {
      lastErrorAt = Date.now()
      showToast('Доска недоступна. Проверьте, что сервер запущен.', { error: true })
    }
    setConnection(false)
  }
}

function render() {
  versionEl.textContent = state.version ? `v${state.version}` : '—'
  document.title = state.tasks.length ? `Kanso — ${state.tasks.length} задач` : 'Kanso — доска'
  if (search.value !== state.query) search.value = state.query

  const empty = state.tasks.length === 0
  emptyBoard.hidden = !empty
  board.hidden = empty
  filters.hidden = empty

  renderFilters()
  renderProjectList()
  if (!empty) renderColumns()
}

function renderFilters() {
  const projects = [...new Set(state.tasks.map((task) => task.project))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
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
  fragment.append(createChip('all', 'Все', state.tasks.length))
  for (const project of projects) fragment.append(createChip(project, project, counts.get(project)))
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

function renderProjectList() {
  const projects = [...new Set(state.tasks.map((task) => task.project))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  )
  if (!projects.includes('Inbox') && !state.tasks.length) projects.push('Inbox')
  const signature = projects.join('|')
  if (projectsList.dataset.signature === signature) return
  projectsList.dataset.signature = signature
  projectsList.replaceChildren(...projects.map((project) => el('option', null, project)))
}

function visibleTask(task) {
  if (state.project !== 'all' && task.project !== state.project) return false
  if (!state.query) return true
  const needle = state.query.toLowerCase()
  return (
    task.id.toLowerCase().includes(needle) ||
    task.title.toLowerCase().includes(needle) ||
    task.project.toLowerCase().includes(needle) ||
    task.labels.some((label) => label.toLowerCase().includes(needle))
  )
}

function renderColumns() {
  const grouped = new Map(STATUSES.map((status) => [status.id, []]))
  grouped.set(CANCELED.id, [])
  for (const task of state.tasks) {
    if (!visibleTask(task)) continue
    if (!grouped.has(task.status)) grouped.set(task.status, [])
    grouped.get(task.status).push(task)
  }

  const defs = STATUSES.slice()
  if (grouped.get(CANCELED.id).length) defs.push(CANCELED)

  for (const def of defs) {
    let column = columns.get(def.id)
    if (!column) {
      column = createColumn(def)
      columns.set(def.id, column)
      board.append(column)
    }
    const count = grouped.get(def.id)?.length ?? 0
    column.querySelector('.column-count').textContent = String(count)
    reconcile(column.querySelector('.column-list'), grouped.get(def.id) ?? [])
  }

  for (const [id, column] of columns) {
    if (!defs.some((def) => def.id === id)) {
      column.remove()
      columns.delete(id)
    }
  }

  const boardOrder = [...board.children]
  const desired = defs.map((def) => columns.get(def.id))
  for (const column of desired) board.append(column)
  for (const column of boardOrder) {
    if (!desired.includes(column)) column.remove()
  }
}

function createColumn(def) {
  const column = el('section', 'column')
  column.dataset.status = def.id

  const head = el('header', 'column-head')
  head.append(el('span', 'column-dot'))
  const title = el('h2', 'column-title', def.label)
  head.append(title, el('span', 'column-count', '0'))

  const add = el('button', 'column-add')
  add.type = 'button'
  add.setAttribute('aria-label', `Добавить задачу в «${def.label}»`)
  add.innerHTML =
    '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"></path></svg>'
  add.addEventListener('click', () => openCompose(def.id))
  head.append(add)

  const list = el('div', 'column-list')
  list.dataset.status = def.id
  list.setAttribute('role', 'list')

  column.append(head, list)
  return column
}

function reconcile(list, tasks) {
  for (const empty of list.querySelectorAll('.column-empty')) empty.remove()

  const existing = new Map()
  for (const node of list.querySelectorAll(':scope > .card')) existing.set(node.dataset.id, node)

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

  for (const card of existing.values()) card.remove()

  if (!tasks.length) {
    const empty = el('div', 'column-empty', state.query ? 'Ничего не найдено' : 'Перетащите задачу сюда')
    list.append(empty)
  }
}

function moveNode(parent, node, reference) {
  if (reference && reference.parentElement === parent) {
    if (node.parentElement === parent && parent.moveBefore) parent.moveBefore(node, reference)
    else parent.insertBefore(node, reference)
    return
  }
  if (node.parentElement === parent && parent.moveBefore) parent.moveBefore(node, null)
  else parent.append(node)
}

function createCard(task) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true)
  card.dataset.id = task.id
  card.setAttribute('role', 'listitem')
  card.addEventListener('click', (event) => {
    if (event.target.closest('.card-handle')) return
    openTask(task.id)
  })
  card.querySelector('.card-handle').addEventListener('pointerdown', onPointerDown)
  card.querySelector('.card-handle').addEventListener('keydown', onHandleKeyDown)
  return card
}

function updateCard(card, task) {
  card.dataset.updated = task.updated_at
  card.style.setProperty('--hue', hueOf(task.project))

  card.querySelector('.card-id').textContent = task.id
  const title = card.querySelector('.card-title')
  title.textContent = task.title
  title.setAttribute('aria-label', `Открыть ${task.id}: ${task.title}`)

  const handle = card.querySelector('.card-handle')
  handle.setAttribute('aria-label', `Переместить ${task.id}`)

  const labels = card.querySelector('.card-labels')
  labels.replaceChildren(
    ...task.labels.slice(0, 3).map((label) => el('span', 'label', label)),
    ...(task.labels.length > 3 ? [el('span', 'label', `+${task.labels.length - 3}`)] : []),
  )

  const projectName = card.querySelector('.project-name')
  projectName.textContent = task.project
  card.querySelector('.project-dot').style.setProperty('--hue', hueOf(task.project))

  const priority = card.querySelector('.card-priority')
  priority.textContent = `p${task.priority}`
  priority.dataset.priority = String(task.priority)
  priority.title = ['Критический', 'Высокий', 'Обычный', 'Низкий'][task.priority] ?? 'Приоритет'

  const owner = card.querySelector('.card-owner')
  const lease = card.querySelector('.card-lease')
  if (task.claim) {
    owner.hidden = false
    owner.title = `Сессия ${task.claim.session}`
    owner.querySelector('.owner-avatar').style.setProperty('--owner-hue', hueOf(task.claim.session))
    owner.querySelector('.owner-name').textContent = shortSession(task.claim.session)
    lease.hidden = false
    lease.textContent = leaseLabel(task.claim.lease_until)
    lease.classList.toggle('is-stale', Boolean(task.stale))
  } else {
    owner.hidden = true
    lease.hidden = true
  }
}

/* ---------- Перетаскивание ---------- */

function onPointerDown(event) {
  if (event.button !== 0) return
  const handle = event.target.closest('.card-handle')
  if (!handle) return
  const card = handle.closest('.card')
  if (!card) return

  event.preventDefault()
  drag = {
    card,
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    drop: null,
    raf: 0,
  }

  handle.setPointerCapture(event.pointerId)
  card.classList.add('is-dragging')
  card.style.transform = 'translate3d(0, 0, 0) scale(1.015)'
  document.body.classList.add('is-reordering')
  drag.raf = requestAnimationFrame(autoScroll)
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag.lastX = event.clientX
  drag.lastY = event.clientY
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  drag.card.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.015)`
  updateDrop()
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const { card, drop } = drag
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
  announce(`${card.querySelector('.card-title').textContent} → ${labelOfStatus(drop.status)}`)
}

function onPointerCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  endDrag()
  announce('Перемещение отменено')
}

function endDrag() {
  if (!drag) return
  const { card, raf } = drag
  cancelAnimationFrame(raf)
  if (card) {
    card.classList.remove('is-dragging')
    card.style.removeProperty('transform')
  }
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

  if (!column || column.dataset.status === CANCELED.id) return

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
      announce('Дальше некуда')
      return
    }
    const beforeId =
      key === 'ArrowUp' ? swap.dataset.id : swap.nextElementSibling?.dataset.id ?? null
    applyMove(card, list.dataset.status, beforeId, { animate: false })
    announce(`${title} → ${labelOfStatus(list.dataset.status)}, позиция ${key === 'ArrowUp' ? index : index + 2}`)
  } else {
    const order = [...board.querySelectorAll('.column')].filter(
      (column) => column.dataset.status !== CANCELED.id,
    )
    const current = list.closest('.column')
    const next = order[order.indexOf(current) + (key === 'ArrowRight' ? 1 : -1)]
    if (!next) {
      announce('Дальше некуда')
      return
    }
    const targetList = next.querySelector('.column-list')
    const first = targetList.querySelector(':scope > .card')
    applyMove(card, next.dataset.status, first?.dataset.id ?? null, { animate: false })
    announce(`${title} → ${labelOfStatus(next.dataset.status)}`)
  }

  requestAnimationFrame(() => handle.focus({ preventScroll: true }))
}

/* ---------- Перемещение ---------- */

function applyMove(card, status, beforeId, { animate = true } = {}) {
  const targetList = board.querySelector(`.column-list[data-status="${status}"]`)
  if (!targetList) return

  const before =
    beforeId ? targetList.querySelector(`.card[data-id="${beforeId}"]`) : null
  const sourceList = card.parentElement
  const sameColumn = sourceList === targetList

  const update = () => {
    for (const empty of targetList.querySelectorAll('.column-empty')) empty.remove()
    moveNode(targetList, card, before)
  }

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

  const task = state.tasks.find((item) => item.id === card.dataset.id)
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

  markLocal()
  api(`/api/tasks/${encodeURIComponent(card.dataset.id)}/move`, {
    method: 'POST',
    body: { status, beforeId },
  })
    .then(({ task: updated }) => {
      if (!task || !updated) return
      Object.assign(task, updated)
      const node = board.querySelector(`.card[data-id="${updated.id}"]`)
      if (node) updateCard(node, task)
    })
    .catch((error) => {
      showToast(`Не удалось переместить: ${error.message}`, { error: true })
      loadBoard()
    })

  updateColumnCounts()
}

function updateColumnCounts() {
  for (const column of board.querySelectorAll('.column')) {
    const list = column.querySelector('.column-list')
    const count = list.querySelectorAll(':scope > .card').length
    column.querySelector('.column-count').textContent = String(count)
    const empty = list.querySelector('.column-empty')
    if (count && empty) empty.remove()
    if (!count && !empty) {
      list.append(el('div', 'column-empty', state.query ? 'Ничего не найдено' : 'Перетащите задачу сюда'))
    }
  }
}

/* ---------- Карточка задачи ---------- */

async function openTask(id) {
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(id)}`)
    currentTaskId = id
    renderDrawer(data)
    if (!taskDialog.open) taskDialog.showModal()
  } catch (error) {
    showToast(`Не удалось открыть задачу: ${error.message}`, { error: true })
  }
}

function renderDrawer({ task, comments, threads }) {
  document.querySelector('#drawer-id').textContent = task.id
  document.querySelector('#drawer-project').textContent = task.project
  document.querySelector('#task-dialog-title').textContent = task.title

  const badges = document.querySelector('#drawer-badges')
  const badgeItems = [
    el('span', 'badge', labelOfStatus(task.status)),
    el('span', 'badge', `p${task.priority}`),
    el('span', 'badge', task.project),
  ]
  badgeItems[1].dataset.kind = `priority-${task.priority}`
  if (task.claim) badgeItems.push(el('span', 'badge', task.stale ? 'аренда истекла' : 'в аренде'))
  badges.replaceChildren(...badgeItems)

  document.querySelector('#drawer-body').textContent = task.body ?? ''

  const meta = document.querySelector('#drawer-meta')
  const entries = [
    ['Создана', dateLabel(task.created_at), false],
    ['Обновлена', agoLabel(task.updated_at), false],
  ]
  if (task.claim) {
    entries.push(['Владелец', task.claim.session, true])
    entries.push(['Аренда', leaseLabel(task.claim.lease_until), true])
  }
  if (task.claim?.touched_paths?.length) {
    entries.push(['Файлы', task.claim.touched_paths.join(', '), true])
  }
  if (task.blocked_by.length) entries.push(['Блокеры', task.blocked_by.join(', '), true])
  if (task.labels.length) entries.push(['Метки', task.labels.join(', '), false])

  meta.replaceChildren(
    ...entries.map(([term, value, mono]) => {
      const block = el('div')
      block.append(el('dt', null, term))
      const dd = el('dd', mono ? 'mono' : null, value)
      block.append(dd)
      return block
    }),
  )

  drawerStatus.replaceChildren(
    ...[...STATUSES, CANCELED].map((status) => {
      const option = el('option', null, status.label)
      option.value = status.id
      option.selected = status.id === task.status
      return option
    }),
  )
  drawerDone.disabled = task.status === 'done' || task.status === 'canceled'

  const threadSection = document.querySelector('#drawer-threads-section')
  const threadList = document.querySelector('#drawer-threads')
  threadSection.hidden = !threads.length
  threadList.replaceChildren(...threads.map(renderThread))

  document.querySelector('#comment-count').textContent = String(comments.length)
  const commentList = document.querySelector('#drawer-comments')
  if (!comments.length) {
    commentList.replaceChildren(el('p', 'comment-empty', 'Пока пусто. Запишите состояние или решение.'))
  } else {
    commentList.replaceChildren(...comments.map(renderComment))
  }

  commentForm.dataset.taskId = task.id
  commentForm.reset()
}

function renderThread(thread) {
  const box = el('div', 'thread')
  box.dataset.state = thread.state

  const head = el('div', 'thread-head')
  head.append(
    el('span', null, thread.id),
    el('span', 'thread-state', thread.state.replace('_', ' ')),
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
    box.append(el('p', 'comment-empty', 'Нужно решение человека. Запишите его в комментарии к задаче.'))
  }

  return box
}

function renderComment(comment) {
  const box = el('div', 'comment')
  const head = el('div', 'comment-head')
  head.append(
    el('span', null, comment.session_id ? shortSession(comment.session_id) : 'доска'),
    el('span', 'comment-kind', comment.kind),
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
    showToast(`Не удалось сменить статус: ${error.message}`, { error: true })
  }
}

/* ---------- Создание ---------- */

function openCompose(status = 'backlog') {
  composeTarget = status
  composeForm.reset()
  composeForm.elements.project.value = state.project === 'all' ? 'Inbox' : state.project
  composeDialog.showModal()
  requestAnimationFrame(() => composeForm.elements.title.focus())
}

async function submitCompose(event) {
  event.preventDefault()
  const form = new FormData(composeForm)
  const title = String(form.get('title') ?? '').trim()
  if (!title) {
    composeForm.elements.title.focus()
    return
  }

  const labels = String(form.get('labels') ?? '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean)

  try {
    markLocal()
    const created = await api('/api/tasks', {
      method: 'POST',
      body: {
        title,
        body: String(form.get('body') ?? ''),
        project: String(form.get('project') ?? 'Inbox').trim() || 'Inbox',
        priority: Number(form.get('priority') ?? 2),
        labels,
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
    showToast(`Создана ${created.task.id}`)
    announce(`Создана задача ${created.task.id}`)
  } catch (error) {
    showToast(`Не удалось создать: ${error.message}`, { error: true })
  }
}

/* ---------- События ---------- */

board.addEventListener('pointermove', onPointerMove)
board.addEventListener('pointerup', onPointerUp)
board.addEventListener('pointercancel', onPointerCancel)
board.addEventListener('lostpointercapture', (event) => {
  if (drag && event.pointerId === drag.pointerId) {
    endDrag()
    announce('Перемещение отменено')
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drag) {
    endDrag()
    announce('Перемещение отменено')
  }
})

search.addEventListener('input', () => {
  state.query = search.value.trim()
  render()
})

document.querySelector('#new-task').addEventListener('click', () => openCompose())
document.querySelector('#empty-create').addEventListener('click', () => openCompose())

composeForm.addEventListener('submit', submitCompose)

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog')?.close())
}

taskDialog.addEventListener('close', () => {
  currentTaskId = null
})

drawerStatus.addEventListener('change', () => moveFromDrawer(drawerStatus.value))
drawerDone.addEventListener('click', () => moveFromDrawer('done'))

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
    showToast(`Не удалось добавить комментарий: ${error.message}`, { error: true })
  }
})

document.addEventListener('keydown', (event) => {
  const target = event.target
  const typing =
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return

  if (event.key === '/') {
    event.preventDefault()
    search.focus()
    search.select()
  } else if (event.key.toLowerCase() === 'n' && !composeDialog.open && !taskDialog.open) {
    event.preventDefault()
    openCompose()
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

loadBoard().then(connectEvents)
window.setInterval(() => {
  for (const card of board.querySelectorAll('.card')) {
    const task = state.tasks.find((item) => item.id === card.dataset.id)
    const lease = card.querySelector('.card-lease')
    if (task?.claim && !lease.hidden) {
      lease.textContent = leaseLabel(task.claim.lease_until)
      lease.classList.toggle('is-stale', new Date(task.claim.lease_until) <= new Date())
    }
  }
}, 30_000)

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadBoard()
})