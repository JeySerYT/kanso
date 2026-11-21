const SUPPORTED = ['ru', 'en']
const FALLBACK = 'ru'
const STORAGE_KEY = 'kanso.lang'
const cache = new Map()

let locale = FALLBACK
let dictionary = {}
let fallback = {}

const normalize = (value) => {
  const raw = String(value ?? '').toLowerCase()
  if (raw.startsWith('ru')) return 'ru'
  if (raw.startsWith('en')) return 'en'
  return ''
}

const detect = () => {
  try {
    const saved = normalize(localStorage.getItem(STORAGE_KEY))
    if (saved) return saved
  } catch {
    // localStorage может быть недоступен в приватном режиме.
  }
  for (const language of navigator.languages ?? [navigator.language]) {
    const matched = normalize(language)
    if (matched) return matched
  }
  return FALLBACK
}

const load = async (lang) => {
  if (!cache.has(lang)) {
    const response = await fetch(`/locales/${lang}.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`locale_${lang}_${response.status}`)
    cache.set(lang, await response.json())
  }
  return cache.get(lang)
}

export async function initI18n() {
  const next = detect()
  fallback = await load(FALLBACK)
  await useLanguage(next, { persist: false })
  return locale
}

export async function useLanguage(next, { persist = true } = {}) {
  const lang = normalize(next) || FALLBACK
  dictionary = await load(lang)
  locale = lang
  document.documentElement.lang = lang
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      // Настройка не сохранится, но интерфейс продолжит работать.
    }
  }
  return locale
}

export const currentLocale = () => locale
export const localeTag = () => (locale === 'ru' ? 'ru-RU' : 'en-US')
export const supportedLocales = () => SUPPORTED.slice()

export function t(key, params = {}) {
  const template = dictionary[key] ?? fallback[key] ?? key
  return String(template).replace(/\{(\w+)\}/g, (_, name) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  )
}

export function hasKey(key) {
  return key in dictionary || key in fallback
}

export function applyStaticTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n)
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder))
  }
  for (const node of root.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel))
  }
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.setAttribute('title', t(node.dataset.i18nTitle))
  }
  document.title = t('app.title')
}