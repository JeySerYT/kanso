import { t } from '../i18n.js'
import { CANCELED, announce, board, statusLabel } from './core.js'
import { applyMove } from './board.js'
import { dragEnded } from './events.js'

let drag = null

export function isDragging() {
  return Boolean(drag)
}

export function onLostPointerCapture(event) {
  if (drag && event.pointerId === drag.pointerId) {
    endDrag()
    announce(t('announce.cancelled'))
  }
}

export function onPointerDown(event) {
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

export function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  drag.lastX = event.clientX
  drag.lastY = event.clientY
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  drag.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.015)`
  updateDrop()
}

export function onPointerUp(event) {
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

export function onPointerCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return
  endDrag()
  announce(t('announce.cancelled'))
}

export function endDrag() {
  if (!drag) return
  const { card, ghost, raf } = drag
  cancelAnimationFrame(raf)
  ghost?.remove()
  card?.classList.remove('is-drag-origin')
  document.body.classList.remove('is-reordering')
  clearDropMarker()
  drag = null
  dragEnded()
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

export function onHandleKeyDown(event) {
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