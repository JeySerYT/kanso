import { t } from '../i18n.js'
import {
  CANCELED,
  PRIORITY_MAX,
  STATUS_IDS,
  agoLabel,
  announce,
  api,
  blockerOptions,
  blockerQuery,
  commentForm,
  dateLabel,
  deleteDialog,
  deleteText,
  drawerBlockers,
  drawerCancel,
  drawerDone,
  drawerLabelPicker,
  drawerPriority,
  drawerStatus,
  drawerTitle,
  el,
  errorText,
  leaseCountdown,
  markLocal,
  option,
  paletteDialog,
  shortSession,
  showToast,
  state,
  statusLabel,
  taskById,
  taskDialog,
} from './core.js'
import { labelChip, loadBoard } from './board.js'
import { renderPalette } from './palette.js'

let currentTaskId = null
let pendingDeleteId = null

export const getCurrentTaskId = () => currentTaskId

export function onDrawerClose() {
  currentTaskId = null
}

export function onDeleteDialogClose() {
  pendingDeleteId = null
}

export async function openTask(id) {
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

export function renderBlockerOptions(task) {
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

export async function moveFromDrawer(status) {
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

export async function cancelTask() {
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

export function requestDelete(id) {
  const task = taskById(id)
  if (!task) return
  pendingDeleteId = id
  deleteText.textContent = t('delete.text', { title: task.title, id: task.id })
  if (!deleteDialog.open) deleteDialog.showModal()
}

export async function confirmDelete() {
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

// Задачу могли удалить в другой вкладке — не оставляем пустой drawer и диалог удаления.
export function syncOpenDialogs() {
  if (taskDialog.open && currentTaskId && !taskById(currentTaskId)) taskDialog.close()
  if (deleteDialog.open && pendingDeleteId && !taskById(pendingDeleteId)) deleteDialog.close()
  // Блокировки могли поменять в другой вкладке — обновляем чипы, не трогая открытый поиск.
  if (taskDialog.open && currentTaskId) {
    const fresh = taskById(currentTaskId)
    if (fresh && drawerBlockers.dataset.blockedBy !== JSON.stringify(fresh.blocked_by)) {
      renderBlockerChips(fresh)
    }
  }
}

// Смена языка: текст подтверждения удаления пересобирается под новую локаль.
export function refreshDeleteText() {
  if (!pendingDeleteId) return
  const task = taskById(pendingDeleteId)
  if (task) deleteText.textContent = t('delete.text', { title: task.title, id: task.id })
}

export async function changeDrawerPriority() {
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
}

export async function submitComment(event) {
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
}