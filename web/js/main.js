import { applyStaticTranslations, currentLocale, initI18n, t } from '../i18n.js'
import {
  SORT_MODES,
  blockerOptions,
  blockerQuery,
  board,
  commentForm,
  composeBranch,
  composeDialog,
  composeForm,
  composeProject,
  deleteConfirm,
  deleteDialog,
  densityToggle,
  drawerCancel,
  drawerDelete,
  drawerDone,
  drawerPriority,
  drawerStatus,
  drawerTitle,
  emptyCreate,
  errorRetry,
  effectsToggle,
  filterLabel,
  filterLeased,
  filterPriority,
  filterReset,
  graphReset,
  helpDialog,
  helpOpen,
  hideToast,
  labelAdd,
  labelName,
  languageSelect,
  leaseCountdown,
  newTask,
  paletteOpen,
  paletteQuery,
  search,
  searchClear,
  sortSelect,
  state,
  storage,
  taskById,
  taskDialog,
  toastClose,
  viewBoard,
  viewGraph,
} from './core.js'
import { loadBoard, loadProjects, render, startTitleEdit } from './board.js'
import { readFiltersFromUrl, resetFilters, setDensity, setSort } from './toolbar.js'
import {
  addLabel,
  composeHasDraft,
  openCompose,
  populateComposeBranches,
  submitCompose,
  syncNewBranchField,
  syncNewProjectField,
} from './compose.js'
import {
  cancelTask,
  changeDrawerPriority,
  confirmDelete,
  getCurrentTaskId,
  moveFromDrawer,
  onDeleteDialogClose,
  onDrawerClose,
  rememberCommentDraft,
  renderBlockerOptions,
  requestDelete,
  submitComment,
} from './drawer.js'
import {
  getPaletteIndex,
  openPalette,
  renderPalette,
  runPalette,
  setPaletteIndex,
} from './palette.js'
import { onEscapeDrag, onGlobalKeyDown } from './hotkeys.js'
import { onLostPointerCapture, onPointerCancel, onPointerMove, onPointerUp } from './drag.js'
import { connectEvents } from './events.js'
import { changeLanguage } from './language.js'
import { initGraph, initView, setView, syncViewFromLocation } from './graph.js'
import { initEffects, toggleEffects } from './effects.js'

/* ---------- События ---------- */

board.addEventListener('pointermove', onPointerMove)
board.addEventListener('pointerup', onPointerUp)
board.addEventListener('pointercancel', onPointerCancel)
board.addEventListener('lostpointercapture', onLostPointerCapture)

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

document.addEventListener('keydown', onEscapeDrag)

search.addEventListener('input', () => {
  // В поле хранится ровно то, что набрал пользователь: trim() только при поиске,
  // иначе пробел между словами стирался сразу после ввода.
  state.query = search.value
  render()
})

searchClear.addEventListener('click', () => {
  state.query = ''
  search.value = ''
  search.focus()
  render()
})

newTask.addEventListener('click', () => openCompose())
emptyCreate.addEventListener('click', () => openCompose())

// «Повторить» после сбоя загрузки: панель скроется, пока идёт запрос,
// и вернётся, если сервер снова не ответил.
errorRetry.addEventListener('click', () => {
  void loadBoard()
})

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
paletteOpen.addEventListener('click', openPalette)
helpOpen.addEventListener('click', () => helpDialog.showModal())

viewBoard.addEventListener('click', () => setView('board'))
viewGraph.addEventListener('click', () => setView('graph'))
graphReset.addEventListener('click', resetFilters)
effectsToggle.addEventListener('click', toggleEffects)
window.addEventListener('hashchange', syncViewFromLocation)

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
  button.addEventListener('click', () => {
    const dialog = button.closest('dialog')
    if (!dialog) return
    if (dialog === composeDialog && !canCloseCompose()) return
    dialog.close()
  })
}

// Незавершённая задача не должна исчезать от случайного Esc или клика по фону.
// Черновик комментария в drawer не теряется: он хранится по id задачи.
function canCloseCompose() {
  return !composeHasDraft() || window.confirm(t('compose.discard'))
}

composeDialog.addEventListener('cancel', (event) => {
  if (!canCloseCompose()) event.preventDefault()
})

taskDialog.addEventListener('close', onDrawerClose)

drawerTitle.addEventListener('dblclick', () => {
  const task = taskById(getCurrentTaskId())
  if (task) startTitleEdit(drawerTitle, task, { large: true })
})
drawerStatus.addEventListener('change', () => moveFromDrawer(drawerStatus.value))
blockerQuery.addEventListener('input', () => {
  const task = taskById(getCurrentTaskId())
  if (task) renderBlockerOptions(task)
})
taskDialog.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.blocker-picker')) blockerOptions.hidden = true
})
drawerDone.addEventListener('click', () => moveFromDrawer('done'))
drawerCancel.addEventListener('click', cancelTask)
drawerDelete.addEventListener('click', () => requestDelete(getCurrentTaskId()))
deleteConfirm.addEventListener('click', confirmDelete)
deleteDialog.addEventListener('close', onDeleteDialogClose)
drawerPriority.addEventListener('change', changeDrawerPriority)

commentForm.addEventListener('submit', submitComment)
commentForm.addEventListener('input', rememberCommentDraft)

paletteQuery.addEventListener('input', renderPalette)
paletteQuery.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setPaletteIndex(getPaletteIndex() + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    setPaletteIndex(getPaletteIndex() - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    runPalette(getPaletteIndex())
  }
})

document.addEventListener('keydown', onGlobalKeyDown)

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
      if (!pressedOutside || !outside(event, dialog)) return
      if (dialog === composeDialog && !canCloseCompose()) return
      dialog.close()
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
  readFiltersFromUrl()
  setDensity(storage.get('kanso.density', 'comfortable'))
  readFiltersFromUrl()
  initEffects()
  initGraph()
  initView()
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