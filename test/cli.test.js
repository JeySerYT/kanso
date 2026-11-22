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
test('--help печатает цикл и команды без обращения к базе', async () => {
  const { code, text } = await capture(['--help'])

  assert.equal(code, 0)
  assert.ok(text.includes('kanso next'))
  assert.ok(text.includes('Цикл:'))
})

test('new --status todo кладёт задачу сразу в очередь', async (t) => {
  const db = tempDb(t)

  const { text } = await capture(['new', 'В очередь', '--project', 'AniVella', '--status', 'todo', '--db', db])

  assert.ok(text.includes('ANI-1'))
  const store = openStore(db)
  assert.equal(store.getTask('ANI-1').status, 'todo')
  store.close()
})

test('new --status done отклоняет недопустимый статус и ничего не создаёт', async (t) => {
  const db = tempDb(t)

  await assert.rejects(run(['new', 'Нельзя', '--status', 'done', '--db', db], { out: () => {} }), /использование/)

  const store = openStore(db)
  assert.equal(store.listTasks().length, 0)
  store.close()
})

test('next берёт задачу с лучшим приоритетом и переводит в работу', async (t) => {
  const db = tempDb(t)
  await run(['new', 'Обычная', '--project', 'AniVella', '--priority', '2', '--status', 'todo', '--db', db], { out: () => {} })
  await run(['new', 'Срочная', '--project', 'AniVella', '--priority', '0', '--status', 'todo', '--db', db], { out: () => {} })

  const { text } = await capture(['next', '--session', 'ses_test', '--paths', 'src/a.js', '--db', db])

  assert.ok(text.includes('ANI-2'))
  const store = openStore(db)
  const task = store.getTask('ANI-2')
  assert.equal(task.status, 'in_progress')
  assert.equal(task.claim.session, 'ses_test')
  assert.deepEqual(task.claim.touched_paths, ['src/a.js'])
  store.close()
})

test('next пропускает заблокированную задачу и называет её', async (t) => {
  const db = tempDb(t)
  await run(['new', 'Сначала', '--project', 'AniVella', '--priority', '2', '--status', 'todo', '--db', db], { out: () => {} })
  await run(['new', 'Потом', '--project', 'AniVella', '--priority', '0', '--status', 'todo', '--blocked-by', 'ANI-1', '--db', db], { out: () => {} })

  const first = await capture(['next', '--session', 'ses_test', '--db', db])
  assert.ok(first.text.includes('ANI-1'))

  const second = await capture(['next', '--session', 'ses_test', '--db', db])
  assert.ok(second.text.includes('ANI-2'))
  assert.ok(/заблокирован/.test(second.text))
})

test('next на пустом todo подсказывает, как создать задачу', async (t) => {
  const db = tempDb(t)

  const { text } = await capture(['next', '--db', db])

  assert.ok(text.includes('--status todo'))
})
