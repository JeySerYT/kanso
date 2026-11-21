import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.KANSO_LANG = 'ru'
const { run } = await import('../src/cli.js')
const { openStore } = await import('../src/store.js')

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kanso-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'board.db')
}

const capture = async (argv) => {
  const lines = []
  const code = await run(argv, { out: (line) => lines.push(line) })
  return { code, text: lines.join('\n') }
}

test('delete без --yes отказывает и подсказывает флаг', async (t) => {
  const db = tempDb(t)
  await run(['new', 'Задача', '--project', 'AniVella', '--db', db], { out: () => {} })

  await assert.rejects(run(['delete', 'ANI-1', '--db', db], { out: () => {} }), /--yes/)

  const store = openStore(db)
  assert.ok(store.getTask('ANI-1'))
  store.close()
})

test('delete --yes удаляет задачу навсегда', async (t) => {
  const db = tempDb(t)
  await run(['new', 'Мусор', '--project', 'AniVella', '--db', db], { out: () => {} })

  const { code, text } = await capture(['delete', 'ANI-1', '--yes', '--db', db])

  assert.equal(code, 0)
  assert.ok(text.includes('ANI-1'))
  const listed = await capture(['list', '--db', db])
  assert.ok(!listed.text.includes('ANI-1'))
})

test('delete несуществующей задачи сообщает о ней', async (t) => {
  const db = tempDb(t)

  const { text } = await capture(['delete', 'ZZZ-9', '--yes', '--db', db])

  assert.ok(text.includes('ZZZ-9'))
})

test('delete чужой арендованной задачи отказывает с владельцем', async (t) => {
  const db = tempDb(t)
  await run(['new', 'В работе', '--project', 'AniVella', '--db', db], { out: () => {} })
  await run(['claim', 'ANI-1', '--session', 'ses_a', '--db', db], { out: () => {} })

  const { text } = await capture(['delete', 'ANI-1', '--yes', '--db', db])

  assert.ok(text.includes('ses_a'))
  const store = openStore(db)
  assert.ok(store.getTask('ANI-1'))
  store.close()
})