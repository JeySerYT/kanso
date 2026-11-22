import { t } from '../i18n.js'
import {
  CANCELED,
  PRIORITY_MAX,
  STATUS_IDS,
  announce,
  api,
  board,
  cardTemplate,
  composeDialog,
  el,
  emptyBoard,
  errorText,
  hueOf,
  labelColor,
  leaseCountdown,
  leaseLabel,
  markLocal,
  option,
  priorityTitle,
  projectsSection,
  reduceMotion,
  search,
  setConnection,
  shortSession,
  showToast,
  state,
  statusLabel,
  taskById,
  toolbar,
  versionEl,
} from './core.js'
import { renderFilters, renderToolbar } from './toolbar.js'
import { openCompose, renderLabelPicker } from './compose.js'
import { openTask, syncOpenDialogs } from './drawer.js'
import { onHandleKeyDown, onPointerDown } from './drag.js'

const columns = new Map()
let lastErrorAt = 0

export async function loadBoard() {
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
    syncOpenDialogs()
  } catch {
    if (Date.now() - lastErrorAt > 5000) {
      lastErrorAt = Date.now()
      showToast(t('toast.boardDown'), { error: true })
    }
    setConnection(false)
  }
}

export async function loadProjects() {
  try {
    const data = await api('/api/projects')
    state.projects = data.projects ?? []
  } catch {
    // Список репозиториев не критичен: проект можно ввести вручную.
  }
}

export function render() {
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

// Сброс колонок при смене языка: подписи и порядок пересоздаются с нуля.
export function resetColumns() {
  columns.clear()
  board.replaceChildren()
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

export function labelChip(name, className = 'label') {
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

export function startTitleEdit(anchor, task, { large = false } = {}) {
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

/* ---------- Перемещение ---------- */

export function applyMove(card, status, beforeId, { animate = true } = {}) {
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