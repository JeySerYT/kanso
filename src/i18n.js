import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'locales')
const FALLBACK = 'ru'
const SUPPORTED = ['ru', 'en']
const cache = new Map()

export function normalizeLocale(value) {
  const raw = String(value ?? '').toLowerCase()
  if (raw.startsWith('ru')) return 'ru'
  if (raw.startsWith('en')) return 'en'
  return ''
}

export function resolveLocale(env = process.env) {
  return (
    normalizeLocale(env.KANSO_LANG) ||
    normalizeLocale(env.LC_ALL) ||
    normalizeLocale(env.LC_MESSAGES) ||
    normalizeLocale(env.LANG) ||
    FALLBACK
  )
}

export function messagesFor(locale) {
  const lang = normalizeLocale(locale) || FALLBACK
  if (!cache.has(lang)) {
    cache.set(lang, JSON.parse(readFileSync(join(LOCALES_DIR, `${lang}.json`), 'utf8')))
  }
  return cache.get(lang)
}

export function translator(locale) {
  const dictionary = messagesFor(locale)
  const fallback = messagesFor(FALLBACK)
  return (key, params = {}) => {
    const template = dictionary[key] ?? fallback[key] ?? key
    return String(template).replace(/\{(\w+)\}/g, (_, name) =>
      params[name] === undefined ? `{${name}}` : String(params[name]),
    )
  }
}

export { SUPPORTED as SUPPORTED_LOCALES }