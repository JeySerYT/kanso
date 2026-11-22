import { t } from '../i18n.js'
import {
  SORT_MODES,
  collator,
  densityToggle,
  densityValue,
  el,
  filterLabel,
  filterLeased,
  filterPriority,
  filterReset,
  filters,
  option,
  sortSelect,
  state,
  storage,
} from './core.js'
import { render } from './board.js'

export function renderFilters() {
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

export function labelNames() {
  const names = new Set(state.labels.map((label) => label.name))
  for (const task of state.tasks) for (const label of task.labels) names.add(label)
  return [...names].sort((a, b) => collator().compare(a, b))
}

export function renderToolbar() {
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

export function resetFilters() {
  state.project = 'all'
  state.query = ''
  state.label = ''
  state.priority = ''
  state.leased = false
  render()
}

export function setSort(mode) {
  state.sort = SORT_MODES.includes(mode) ? mode : 'manual'
  storage.set('kanso.sort', state.sort)
  render()
}

export function setDensity(value) {
  state.density = value === 'compact' ? 'compact' : 'comfortable'
  document.body.classList.toggle('density-compact', state.density === 'compact')
  densityToggle.setAttribute('aria-pressed', String(state.density === 'compact'))
  densityValue.textContent = state.density.toUpperCase()
  storage.set('kanso.density', state.density)
}