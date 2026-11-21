import test from 'node:test'
import assert from 'node:assert/strict'

import { decideThread, PROPOSALS } from '../src/negotiate.js'

const msg = (session, proposal) => ({ from_session: session, proposal })

test('wait и take-now дают согласие в пользу take-now', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'take-now'), msg('ses_b', 'wait')],
  })

  assert.equal(result.state, 'agreed')
  assert.equal(result.winner, 'ses_a')
})

test('два split дают согласие на разделение', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'split'), msg('ses_b', 'split')],
  })

  assert.deepEqual(result, { state: 'agreed', split: true })
})

test('два take-now уходят человеку', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'take-now'), msg('ses_b', 'take-now')],
  })

  assert.equal(result.state, 'needs_decision')
})

test('escalate уходит человеку', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'take-now'), msg('ses_b', 'escalate')],
  })

  assert.equal(result.state, 'needs_decision')
})

test('пока ответила одна сторона, тред ждёт', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'take-now')],
  })

  assert.equal(result.state, 'asked')
})

test('третье сообщение от одной стороны отклоняется', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'take-now'), msg('ses_a', 'wait'), msg('ses_a', 'split')],
  })

  assert.equal(result.state, 'limit')
})

test('неизвестное предложение отклоняется', () => {
  const result = decideThread({
    sessions: ['ses_a', 'ses_b'],
    messages: [msg('ses_a', 'destroy')],
  })

  assert.equal(result.state, 'invalid')
  assert.deepEqual(PROPOSALS, ['take-now', 'wait', 'split', 'escalate'])
})