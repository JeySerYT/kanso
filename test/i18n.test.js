import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeLocale, resolveLocale, translator } from '../src/i18n.js'

const localeDir = join(fileURLToPath(new URL('..', import.meta.url)), 'web', 'locales')

const readLocale = (name) => JSON.parse(readFileSync(join(localeDir, `${name}.json`), 'utf8'))

test('русский и английский словари содержат одинаковые ключи', () => {
  const ru = Object.keys(readLocale('ru'))
  const en = Object.keys(readLocale('en'))

  assert.deepEqual(ru.sort(), en.sort())
})

test('переводчик подставляет параметры и переключает язык', () => {
  assert.equal(translator('ru')('status.done'), 'Готово')
  assert.equal(translator('en')('status.done'), 'Done')
  assert.equal(translator('ru')('app.titleCount', { count: 3 }), 'Kanso — 3 задач')
  assert.equal(translator('en')('app.titleCount', { count: 3 }), 'Kanso — 3 tasks')
})

test('неизвестный ключ возвращается как есть', () => {
  assert.equal(translator('en')('missing.key'), 'missing.key')
})

test('язык определяется из KANSO_LANG, LC_ALL и LANG', () => {
  assert.equal(normalizeLocale('ru_RU.UTF-8'), 'ru')
  assert.equal(normalizeLocale('en_US.UTF-8'), 'en')
  assert.equal(normalizeLocale('de_DE.UTF-8'), '')
  assert.equal(resolveLocale({ KANSO_LANG: 'en' }), 'en')
  assert.equal(resolveLocale({ LC_ALL: 'ru_RU.UTF-8' }), 'ru')
  assert.equal(resolveLocale({ LANG: 'de_DE.UTF-8' }), 'ru')
})