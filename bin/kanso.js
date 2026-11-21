#!/usr/bin/env node

const emitWarning = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '')
  if (text.includes('SQLite is an experimental feature')) return
  emitWarning.call(process, warning, ...rest)
}

const { run } = await import('../src/cli.js')

const code = await run(process.argv.slice(2))
process.exitCode = code