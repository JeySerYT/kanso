import { currentLocale, t } from '../i18n.js'
import {
  SORT_MODES,
  collator,
  el,
  helpDialog,
  paletteDialog,
  paletteEmpty,
  paletteList,
  paletteQuery,
  search,
  state,
} from './core.js'
import { labelNames, resetFilters, setDensity, setSort } from './toolbar.js'
import { render } from './board.js'
import { openCompose } from './compose.js'
import { getCurrentTaskId, openTask, requestDelete } from './drawer.js'
import { changeLanguage } from './language.js'

let paletteItems = []
let paletteIndex = 0

export const getPaletteIndex = () => paletteIndex

function paletteCommands() {
  const items = [
    { kind: 'action', title: t('palette.newTask'), hint: 'C', run: () => openCompose() },
    { kind: 'action', title: t('palette.search'), hint: '/', run: () => { search.focus(); search.select() } },
    { kind: 'action', title: t('palette.reset'), run: resetFilters },
    { kind: 'action', title: t('palette.density'), run: () => setDensity(state.density === 'compact' ? 'comfortable' : 'compact') },
    { kind: 'action', title: t('palette.leased'), run: () => { state.leased = !state.leased; render() } },
    { kind: 'action', title: t('palette.help'), hint: '?', run: () => helpDialog.showModal() },
  ]
  if (getCurrentTaskId()) {
    items.push({ kind: 'action', title: t('palette.deleteTask'), run: () => requestDelete(getCurrentTaskId()) })
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

export function renderPalette() {
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

export function setPaletteIndex(index) {
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

export function runPalette(index) {
  const item = paletteItems[index]
  if (!item) return
  paletteDialog.close()
  item.run()
}

export function openPalette() {
  paletteQuery.value = ''
  renderPalette()
  if (!paletteDialog.open) paletteDialog.showModal()
  paletteQuery.focus()
}