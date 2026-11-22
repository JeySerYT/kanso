import { localeTag, t } from '../i18n.js'
import {
  CANCELED,
  STATUS_IDS,
  announce,
  graphCanvas,
  graphEmpty,
  graphFit,
  graphHint,
  graphTooltip,
  graphView,
  reduceMotion,
  state,
  statusLabel,
  storage,
  viewBoard,
  viewGraph,
  visibleTask,
} from './core.js'
import { render } from './board.js'
import { openTask } from './drawer.js'

/* ---------- Настройки вида ---------- */

const VIEW_KEY = 'kanso.view'
const ZOOM_MIN = 0.25
const ZOOM_MAX = 3
const DPR_MAX = 2
const DRAG_THRESHOLD = 5
const ALPHA_DECAY = 0.985
const ALPHA_MIN = 0.02
const DAMPING = 0.82
const REPULSION = 9000
const SPRING = 0.02
const SPRING_LENGTH = 140
const CENTER_PULL = 0.0025

const nodes = new Map()
const context = graphCanvas.getContext('2d')
let links = []
let colors = {}
let width = 0
let height = 0
let dpr = 1
let previousWidth = 0
let previousHeight = 0
let sized = false
let alpha = 0
let frame = 0
let drawFrame = 0
let lastFrame = 0
let initialized = false
let needsSettle = true
let emptyAnnounced = false

// Мир: (0, 0) — центр графа. Экран = мир * zoom + pan.
const viewport = { x: 0, y: 0, zoom: 1 }

const pointers = new Map()
let gesture = null
let pinch = null
let hovered = null
let selectedId = null

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const radiusFor = (priority) => 8 + (4 - clamp(Number(priority) || 0, 0, 4)) * 2.5
const formatCount = (value) => new Intl.NumberFormat(localeTag()).format(value)

/* ---------- Палитра ---------- */

function readColors() {
  const styles = getComputedStyle(document.documentElement)
  const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback
  colors = {
    bg: token('--bg', '#0a0a0a'),
    text: token('--text', '#eaeaea'),
    text2: token('--text-2', '#c2c2c2'),
    text3: token('--text-3', '#9a9a9a'),
    faint: token('--faint', '#808080'),
    accent: token('--accent', '#ff2a2a'),
    phosphor: token('--phosphor', '#4af626'),
    edge: token('--graph-edge', 'rgba(154, 154, 154, 0.35)'),
    canceled: token('--graph-canceled', 'rgba(255, 42, 42, 0.35)'),
    mono: token('--mono', 'ui-monospace, monospace'),
  }
}

function statusColor(status) {
  if (status === 'backlog') return colors.faint
  if (status === 'todo') return colors.text2
  if (status === 'in_progress') return colors.accent
  if (status === 'review') return colors.text
  if (status === 'done') return colors.text3
  if (status === CANCELED) return colors.canceled
  return colors.text2
}

/* ---------- Вид: доска / граф ---------- */

const isView = (value) => value === 'board' || value === 'graph'

function syncViewButtons() {
  // На пустой доске показывается онбординг, поэтому переключатель отражает «Доску».
  const mode = state.tasks.length ? state.view : 'board'
  for (const [name, button] of [
    ['board', viewBoard],
    ['graph', viewGraph],
  ]) {
    button?.setAttribute('aria-pressed', String(mode === name))
  }
}

export function initView() {
  const hash = location.hash.replace('#', '')
  const stored = storage.get(VIEW_KEY, 'board')
  const mode = isView(hash) ? hash : isView(stored) ? stored : 'board'
  state.view = mode
  storage.set(VIEW_KEY, mode)
  if (!isView(hash)) history.replaceState(null, '', `#${mode}`)
  syncViewButtons()
}

export function setView(mode) {
  if (!isView(mode) || state.view === mode || !state.tasks.length) return
  state.view = mode
  storage.set(VIEW_KEY, mode)
  history.replaceState(null, '', `#${mode}`)
  syncViewButtons()
  render()
  announce(t(mode === 'graph' ? 'announce.viewGraph' : 'announce.viewBoard'))
}

// Ручная правка hash — тот же переключатель. history.replaceState не создаёт
// записей, поэтому «назад/вперёд» вид не переключают.
export function syncViewFromLocation() {
  const hash = location.hash.replace('#', '')
  if (!isView(hash) || hash === state.view) return
  state.view = hash
  storage.set(VIEW_KEY, hash)
  syncViewButtons()
  render()
  announce(t(hash === 'graph' ? 'announce.viewGraph' : 'announce.viewBoard'))
}

/* ---------- Данные ---------- */

const statusOrder = (status) => {
  const index = STATUS_IDS.indexOf(status)
  return index === -1 ? STATUS_IDS.length : index
}

function syncNodes() {
  const visible = state.tasks.filter(visibleTask)
  const visibleIds = new Set(visible.map((task) => task.id))
  const grouped = new Map()
  for (const task of visible) {
    const key = task.status
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(task)
  }

  let added = false
  for (const [status, list] of grouped) {
    list.sort((a, b) => a.id.localeCompare(b.id))
    const x = (statusOrder(status) - 2) * 190
    list.forEach((task, index) => {
      let node = nodes.get(task.id)
      if (!node) {
        // Детерминированная стартовая раскладка по колонкам статуса:
        // одинаковый граф всегда собирается одинаково.
        node = {
          id: task.id,
          task,
          x: x + Math.cos(index * 2.4) * 16,
          y: (index - (list.length - 1) / 2) * 92 + Math.sin(index * 1.7) * 10,
          vx: 0,
          vy: 0,
          pinned: false,
          radius: radiusFor(task.priority),
        }
        nodes.set(task.id, node)
        added = true
      }
      node.task = task
      node.radius = radiusFor(task.priority)
    })
  }

  for (const id of [...nodes.keys()]) {
    if (!visibleIds.has(id)) {
      nodes.delete(id)
      added = true
    }
  }

  links = []
  for (const node of nodes.values()) {
    for (const blockerId of node.task.blocked_by ?? []) {
      const source = nodes.get(blockerId)
      if (source) links.push({ source, target: node })
    }
  }

  if (added) {
    alpha = 1
    needsSettle = true
  }
}

/* ---------- Раскладка ---------- */

function step() {
  const list = [...nodes.values()]
  for (const node of list) {
    node.fx = 0
    node.fy = 0
  }

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let dist = Math.hypot(dx, dy)
      if (dist < 0.5) {
        // Совпавшие точки расталкиваем предсказуемо, без случайности.
        dx = (i - j) * 0.5 + 0.5
        dy = (i + j) * 0.5 + 0.5
        dist = Math.hypot(dx, dy)
      }
      const force = (REPULSION / (dist * dist)) * alpha
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.fx -= fx
      a.fy -= fy
      b.fx += fx
      b.fy += fy
    }
  }

  for (const link of links) {
    const a = link.source
    const b = link.target
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy) || 0.5
    const force = (dist - SPRING_LENGTH) * SPRING * alpha
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.fx += fx
    a.fy += fy
    b.fx -= fx
    b.fy -= fy
  }

  for (const node of list) {
    node.fx -= node.x * CENTER_PULL * alpha
    node.fy -= node.y * CENTER_PULL * alpha
    if (node.pinned || node === gesture?.node) {
      node.vx = 0
      node.vy = 0
      continue
    }
    node.vx = (node.vx + node.fx) * DAMPING
    node.vy = (node.vy + node.fy) * DAMPING
    const speed = Math.hypot(node.vx, node.vy)
    if (speed > 24) {
      node.vx *= 24 / speed
      node.vy *= 24 / speed
    }
    node.x += node.vx
    node.y += node.vy
  }

  alpha *= ALPHA_DECAY
}

function settleStatic() {
  alpha = 1
  const steps = nodes.size > 150 ? 90 : 240
  for (let i = 0; i < steps && alpha > ALPHA_MIN; i += 1) step()
  alpha = 0
}

/* ---------- Отрисовка ---------- */

function drawEdge(link, highlighted) {
  const ctx = context
  const a = link.source
  const b = link.target
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return

  const ux = dx / dist
  const uy = dy / dist
  const startX = a.x + ux * (a.radius + 2)
  const startY = a.y + uy * (a.radius + 2)
  const endX = b.x - ux * (b.radius + 4)
  const endY = b.y - uy * (b.radius + 4)

  ctx.strokeStyle = highlighted ? colors.accent : colors.edge
  ctx.lineWidth = (highlighted ? 1.8 : 1) / viewport.zoom
  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  ctx.stroke()

  const size = 7 / viewport.zoom
  const tipX = endX
  const tipY = endY
  ctx.fillStyle = highlighted ? colors.accent : colors.edge
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(tipX - ux * size - uy * size * 0.6, tipY - uy * size + ux * size * 0.6)
  ctx.lineTo(tipX - ux * size + uy * size * 0.6, tipY - uy * size - ux * size * 0.6)
  ctx.closePath()
  ctx.fill()
}

function drawNode(node, now) {
  const ctx = context
  const task = node.task
  const active = Boolean(task.claim) && new Date(task.claim.lease_until).getTime() > now
  const selected = node === gesture?.node || node.id === hovered || node.id === selectedId

  ctx.beginPath()
  ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
  ctx.fillStyle = statusColor(task.status)
  ctx.fill()

  if (task.status === CANCELED) {
    ctx.strokeStyle = colors.accent
    ctx.lineWidth = 1.2 / viewport.zoom
    ctx.stroke()
  }

  if (active) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.radius + 4 / viewport.zoom, 0, Math.PI * 2)
    ctx.strokeStyle = colors.phosphor
    ctx.lineWidth = 2 / viewport.zoom
    ctx.stroke()
  }

  if (selected) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, node.radius + (active ? 8 : 4) / viewport.zoom, 0, Math.PI * 2)
    ctx.strokeStyle = colors.text
    ctx.lineWidth = 1.5 / viewport.zoom
    ctx.stroke()
  }

  if (viewport.zoom >= 0.55) {
    ctx.font = `${10 / viewport.zoom}px ${colors.mono}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = selected ? colors.text : colors.text3
    ctx.fillText(task.id, node.x, node.y + node.radius + 6 / viewport.zoom)
  }
}

function draw() {
  if (graphView.hidden || !width || !height || !context) return
  const ctx = context

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.translate(viewport.x, viewport.y)
  ctx.scale(viewport.zoom, viewport.zoom)

  const now = Date.now()
  for (const link of links) {
    const highlighted = hovered === link.source.id || hovered === link.target.id
    drawEdge(link, highlighted)
  }
  for (const node of nodes.values()) drawNode(node, now)

  ctx.restore()
}

// Коалесинг интерактивных перерисовок: не больше одного кадра на пачку событий.
function requestDraw() {
  if (drawFrame) return
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0
    draw()
  })
}

function syncAria() {
  const counts = t('graph.canvasAria', {
    tasks: formatCount(nodes.size),
    links: formatCount(links.length),
  })
  const node = selectedId ? nodes.get(selectedId) : null
  graphCanvas.setAttribute(
    'aria-label',
    node
      ? `${counts}. ${t('graph.selected', { id: node.id, title: node.task.title })}`
      : counts,
  )
}

/* ---------- Цикл симуляции ---------- */

function loop(timestamp) {
  frame = 0
  if (graphView.hidden || document.hidden) return
  const elapsed = lastFrame ? Math.min(32, timestamp - lastFrame) : 16
  lastFrame = timestamp

  if (reduceMotion.matches) {
    alpha = 0
    draw()
    return
  }

  if (alpha > ALPHA_MIN) {
    const steps = Math.max(1, Math.round(elapsed / 16))
    for (let i = 0; i < steps; i += 1) step()
    draw()
    frame = requestAnimationFrame(loop)
  } else {
    alpha = 0
    draw()
  }
}

function startLoop() {
  if (graphView.hidden || document.hidden) return
  if (reduceMotion.matches) {
    if (needsSettle) {
      settleStatic()
      needsSettle = false
    }
    draw()
    return
  }
  if (frame) return
  lastFrame = 0
  frame = requestAnimationFrame(loop)
}

function stopLoop() {
  if (frame) cancelAnimationFrame(frame)
  if (drawFrame) cancelAnimationFrame(drawFrame)
  frame = 0
  drawFrame = 0
}

/* ---------- Размер и координаты ---------- */

function measure() {
  if (graphView.hidden) return
  const rect = graphView.getBoundingClientRect()
  const nextWidth = Math.max(0, Math.round(rect.width))
  const nextHeight = Math.max(0, Math.round(rect.height))
  if (!nextWidth || !nextHeight) return

  width = nextWidth
  height = nextHeight
  dpr = Math.min(DPR_MAX, window.devicePixelRatio || 1)
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (graphCanvas.width !== pixelWidth) graphCanvas.width = pixelWidth
  if (graphCanvas.height !== pixelHeight) graphCanvas.height = pixelHeight

  if (!sized) {
    viewport.x = width / 2
    viewport.y = height / 2
    sized = true
  } else {
    viewport.x += (width - previousWidth) / 2
    viewport.y += (height - previousHeight) / 2
  }
  previousWidth = width
  previousHeight = height
}

const toWorld = (clientX, clientY) => {
  const rect = graphCanvas.getBoundingClientRect()
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom,
  }
}

function nodeAt(clientX, clientY) {
  const point = toWorld(clientX, clientY)
  let found = null
  let best = Infinity
  for (const node of nodes.values()) {
    const distance = Math.hypot(point.x - node.x, point.y - node.y)
    if (distance <= node.radius + 6 / viewport.zoom && distance < best) {
      found = node
      best = distance
    }
  }
  return found
}

function zoomAround(nextZoom, screenX, screenY) {
  const zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX)
  if (zoom === viewport.zoom) return
  const worldX = (screenX - viewport.x) / viewport.zoom
  const worldY = (screenY - viewport.y) / viewport.zoom
  viewport.zoom = zoom
  viewport.x = screenX - worldX * zoom
  viewport.y = screenY - worldY * zoom
}

// Вписать все узлы в видимую область; пустой граф возвращает центр.
function fitView() {
  if (!width || !height) return
  if (!nodes.size) {
    viewport.zoom = 1
    viewport.x = width / 2
    viewport.y = height / 2
    requestDraw()
    return
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes.values()) {
    minX = Math.min(minX, node.x - node.radius)
    minY = Math.min(minY, node.y - node.radius)
    maxX = Math.max(maxX, node.x + node.radius)
    maxY = Math.max(maxY, node.y + node.radius)
  }

  const padding = 60
  const zoom = clamp(
    Math.min(
      width / (maxX - minX + padding * 2),
      height / (maxY - minY + padding * 2),
    ),
    ZOOM_MIN,
    ZOOM_MAX,
  )
  viewport.zoom = zoom
  viewport.x = width / 2 - ((minX + maxX) / 2) * zoom
  viewport.y = height / 2 - ((minY + maxY) / 2) * zoom
  requestDraw()
}

/* ---------- Клавиатура ---------- */

function ensureSelection() {
  if (selectedId && nodes.has(selectedId)) return nodes.get(selectedId)
  let best = null
  let bestDistance = Infinity
  for (const node of nodes.values()) {
    const x = node.x * viewport.zoom + viewport.x
    const y = node.y * viewport.zoom + viewport.y
    const distance = Math.hypot(x - width / 2, y - height / 2)
    if (distance < bestDistance) {
      best = node
      bestDistance = distance
    }
  }
  selectedId = best?.id ?? null
  return best
}

function selectNeighbor(key) {
  const current = ensureSelection()
  if (!current) return null
  const dirs = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
  }
  const [dx, dy] = dirs[key]
  let best = null
  let bestScore = Infinity
  for (const node of nodes.values()) {
    if (node === current) continue
    const vx = node.x - current.x
    const vy = node.y - current.y
    const along = vx * dx + vy * dy
    if (along <= 1) continue
    const perpendicular = Math.abs(vx * dy - vy * dx)
    const score = perpendicular * 3 + Math.hypot(vx, vy) * 0.2
    if (score < bestScore) {
      best = node
      bestScore = score
    }
  }
  return best
}

function selectNode(node) {
  selectedId = node?.id ?? null
  syncAria()
  if (node) announce(t('graph.selected', { id: node.id, title: node.task.title }))
  requestDraw()
}

function onKeyDown(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const key = event.key
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
    event.preventDefault()
    const next = selectNeighbor(key)
    if (next) selectNode(next)
    return
  }
  if (key === 'Enter') {
    const node = selectedId ? nodes.get(selectedId) : ensureSelection()
    if (node) {
      event.preventDefault()
      void openTask(node.id)
    }
    return
  }
  if (key === 'Escape') {
    selectedId = null
    syncAria()
    requestDraw()
    return
  }
  if (key === '0' || key === 'Home') {
    event.preventDefault()
    fitView()
    return
  }
  if (key === '+' || key === '=' || key === '-') {
    event.preventDefault()
    const factor = key === '-' ? 1 / 1.2 : 1.2
    zoomAround(viewport.zoom * factor, width / 2, height / 2)
    requestDraw()
  }
}

function onFocus() {
  if (ensureSelection()) {
    syncAria()
    requestDraw()
  }
}

/* ---------- Взаимодействия ---------- */

function hideTooltip() {
  hovered = null
  graphTooltip.hidden = true
}

function showTooltip(node, clientX, clientY) {
  const task = node.task
  graphTooltip.textContent = `${task.id} · ${statusLabel(task.status)}\n${task.title}`
  graphTooltip.hidden = false
  const rect = graphView.getBoundingClientRect()
  const tooltipWidth = graphTooltip.offsetWidth
  const tooltipHeight = graphTooltip.offsetHeight
  let left = clientX - rect.left + 16
  let top = clientY - rect.top + 16
  if (left + tooltipWidth > rect.width - 8) left = clientX - rect.left - tooltipWidth - 16
  if (top + tooltipHeight > rect.height - 8) top = clientY - rect.top - tooltipHeight - 16
  graphTooltip.style.left = `${Math.max(8, left)}px`
  graphTooltip.style.top = `${Math.max(8, top)}px`
}

function updateHover(event) {
  if (gesture || pointers.size) return
  const node = nodeAt(event.clientX, event.clientY)
  const nextId = node?.id ?? null
  graphCanvas.style.cursor = node ? 'pointer' : 'grab'
  if (nextId === hovered) {
    if (node) showTooltip(node, event.clientX, event.clientY)
    return
  }
  hovered = nextId
  if (node) showTooltip(node, event.clientX, event.clientY)
  else graphTooltip.hidden = true
  requestDraw()
}

function pinchState() {
  const [a, b] = [...pointers.values()]
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  }
}

function onPointerDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  event.preventDefault()
  graphCanvas.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  hideTooltip()

  if (pointers.size === 1) {
    const node = nodeAt(event.clientX, event.clientY)
    if (node) {
      const point = toWorld(event.clientX, event.clientY)
      gesture = {
        kind: 'node',
        node,
        grabX: node.x - point.x,
        grabY: node.y - point.y,
        startX: event.clientX,
        startY: event.clientY,
        moved: 0,
      }
    } else {
      gesture = {
        kind: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        panX: viewport.x,
        panY: viewport.y,
        moved: 0,
      }
    }
    graphCanvas.style.cursor = 'grabbing'
  } else if (pointers.size === 2) {
    if (gesture?.kind === 'node' && gesture.moved >= DRAG_THRESHOLD) gesture.node.pinned = true
    gesture = null
    pinch = pinchState()
  }
}

function onPointerMove(event) {
  if (pointers.has(event.pointerId)) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  if (pointers.size >= 2) {
    const next = pinchState()
    if (pinch) {
      const rect = graphCanvas.getBoundingClientRect()
      const ratio = next.dist / pinch.dist
      zoomAround(viewport.zoom * ratio, next.midX - rect.left, next.midY - rect.top)
      viewport.x += next.midX - pinch.midX
      viewport.y += next.midY - pinch.midY
    }
    pinch = next
    requestDraw()
    return
  }

  if (!gesture) {
    updateHover(event)
    return
  }

  const moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
  gesture.moved = Math.max(gesture.moved, moved)

  if (gesture.kind === 'node') {
    const point = toWorld(event.clientX, event.clientY)
    gesture.node.x = point.x + gesture.grabX
    gesture.node.y = point.y + gesture.grabY
    gesture.node.vx = 0
    gesture.node.vy = 0
  } else {
    viewport.x = gesture.panX + (event.clientX - gesture.startX)
    viewport.y = gesture.panY + (event.clientY - gesture.startY)
  }
  requestDraw()
}

function onPointerUp(event) {
  if (!pointers.has(event.pointerId)) return
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null

  if (gesture) {
    if (gesture.kind === 'node') {
      if (gesture.moved >= DRAG_THRESHOLD) gesture.node.pinned = true
      else void openTask(gesture.node.id)
    }
    gesture = null
  }
  graphCanvas.style.cursor = 'grab'
  requestDraw()
}

function onPointerCancel(event) {
  pointers.delete(event.pointerId)
  if (!pointers.size) pinch = null
  gesture = null
  graphCanvas.style.cursor = 'grab'
  requestDraw()
}

function onPointerLeave() {
  if (pointers.size) return
  hideTooltip()
  graphCanvas.style.cursor = 'grab'
  requestDraw()
}

function onWheel(event) {
  // Ctrl+wheel — масштаб страницы, его не перехватываем.
  if (event.ctrlKey) return
  event.preventDefault()
  if (!event.deltaY) return
  const rect = graphCanvas.getBoundingClientRect()
  const factor = Math.exp(-event.deltaY * 0.0015)
  zoomAround(viewport.zoom * factor, event.clientX - rect.left, event.clientY - rect.top)
  hideTooltip()
  requestDraw()
}

/* ---------- Запуск ---------- */

export function initGraph() {
  if (initialized) return
  initialized = true
  readColors()

  graphCanvas.addEventListener('pointerdown', onPointerDown)
  graphCanvas.addEventListener('pointermove', onPointerMove)
  graphCanvas.addEventListener('pointerup', onPointerUp)
  graphCanvas.addEventListener('pointercancel', onPointerCancel)
  graphCanvas.addEventListener('lostpointercapture', onPointerCancel)
  graphCanvas.addEventListener('pointerleave', onPointerLeave)
  graphCanvas.addEventListener('wheel', onWheel, { passive: false })
  graphCanvas.addEventListener('keydown', onKeyDown)
  graphCanvas.addEventListener('focus', onFocus)
  graphFit?.addEventListener('click', fitView)

  new ResizeObserver(() => {
    measure()
    requestDraw()
  }).observe(graphView)

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop()
    else if (!graphView.hidden) startLoop()
  })

  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) stopLoop()
    if (!graphView.hidden) {
      measure()
      startLoop()
      draw()
    }
  })

  window.addEventListener('resize', () => {
    measure()
    requestDraw()
  })

  document.fonts?.ready.then(() => draw())
}

// Вызывается из board.render(): синхронизирует граф с данными доски.
export function renderGraph() {
  syncViewButtons()
  if (graphView.hidden) {
    stopLoop()
    return
  }
  syncNodes()

  const visible = nodes.size
  const empty = visible === 0
  graphEmpty.hidden = !empty
  graphHint.hidden = empty || links.length > 0

  // Тултип мог остаться от узла, который ушёл с доски.
  if (hovered && !nodes.has(hovered)) {
    hideTooltip()
    graphCanvas.style.cursor = 'grab'
  }
  if (selectedId && !nodes.has(selectedId)) selectedId = null
  if (empty && !emptyAnnounced) announce(t('graph.empty'))
  emptyAnnounced = empty

  syncAria()
  measure()
  if (!width || !height) return
  startLoop()
}