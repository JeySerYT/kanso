import { msSinceMutation, setConnection, state } from './core.js'
import { loadBoard } from './board.js'
import { isDragging } from './drag.js'

let refreshTimer = 0
let pendingRefresh = false

function scheduleRefresh() {
  if (isDragging()) {
    pendingRefresh = true
    return
  }
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(loadBoard, 120)
}

// Перетаскивание закончилось: применяем обновление, отложенное на время drag.
export function dragEnded() {
  if (pendingRefresh) {
    pendingRefresh = false
    scheduleRefresh()
  }
}

export function connectEvents() {
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
      // Вкладка спала, сеть рвалась или сервер перезапускался: ревизии
      // разошлись, часть событий потеряна. Догоняем доску, а не ждём
      // следующего изменения — иначе пустая доска висит до перезагрузки.
      if (payload.revision !== state.revision) {
        state.revision = 0
        scheduleRefresh()
      }
      return
    }
    if (payload.revision <= state.revision) return
    if (msSinceMutation() < 900) {
      state.revision = payload.revision
      return
    }
    scheduleRefresh()
  })
}