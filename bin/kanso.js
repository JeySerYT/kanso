#!/usr/bin/env node

const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '')
  if (text.includes('SQLite is an experimental feature')) return
  emitWarning.call(process, warning, ...rest)
}

const { run } = await import('../src/cli.js')

// Ошибку использования печатаем одной строкой: агент читает stdout/exit code,
// а не стектрейс Node. Полный стек — только при KANSO_DEBUG=1.
try {
  process.exitCode = await run(process.argv.slice(2))
} catch (error) {
  console.error(error?.message ?? String(error))
  if (process.env.KANSO_DEBUG === '1') console.error(error?.stack ?? '')
  process.exitCode = 1
}