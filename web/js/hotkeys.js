import { t } from '../i18n.js'
import {
  STATUS_IDS,
  announce,
  board,
  composeDialog,
  helpDialog,
  paletteDialog,
  search,
  statusLabel,
  taskById,
  taskDialog,
} from './core.js'
import { applyMove } from './board.js'
import { openCompose } from './compose.js'
import { endDrag, isDragging } from './drag.js'
import { openPalette } from './palette.js'

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

export function onEscapeDrag(event) {
  if (event.key === 'Escape' && isDragging()) {
    endDrag()
    announce(t('announce.cancelled'))
  }
}

export function onGlobalKeyDown(event) {
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
  if (anyDialogOpen() || isDragging() || board.hidden) return

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
}