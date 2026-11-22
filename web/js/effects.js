import { effectsToggle, effectsValue, storage } from './core.js'

const STORAGE_KEY = 'kanso.effects'

let enabled = true

function apply(next) {
  enabled = next
  document.body.classList.toggle('no-effects', !enabled)
  effectsToggle.setAttribute('aria-pressed', String(enabled))
  effectsValue.textContent = enabled ? 'ON' : 'OFF'
  storage.set(STORAGE_KEY, enabled ? 'on' : 'off')
}

export function initEffects() {
  apply(storage.get(STORAGE_KEY, 'on') !== 'off')
}

export function toggleEffects() {
  apply(!enabled)
}