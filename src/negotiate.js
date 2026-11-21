const PROPOSALS = ['take-now', 'wait', 'split', 'escalate']
const MAX_PER_SIDE = 2

const countBySide = (messages) => {
  const counts = new Map()
  for (const message of messages) {
    counts.set(message.from_session, (counts.get(message.from_session) ?? 0) + 1)
  }
  return counts
}

const lastFrom = (messages) => {
  const map = new Map()
  for (const message of messages) map.set(message.from_session, message.proposal)
  return map
}

const decideThread = ({ sessions, messages }) => {
  if (messages.some((message) => !PROPOSALS.includes(message.proposal))) {
    return { state: 'invalid' }
  }

  const counts = countBySide(messages)
  for (const count of counts.values()) {
    if (count > MAX_PER_SIDE) return { state: 'limit' }
  }
  // Третье сообщение от одной стороны при двух ответах другой — тоже лимит.
  if (messages.length > MAX_PER_SIDE * 2) return { state: 'limit' }

  const answered = new Set(messages.map((message) => message.from_session))
  if (sessions.some((session) => !answered.has(session))) return { state: 'asked' }

  const votes = lastFrom(messages)
  const values = [...votes.values()]

  if (values.includes('escalate')) return { state: 'needs_decision' }

  const splits = values.filter((value) => value === 'split').length
  if (splits === sessions.length) return { state: 'agreed', split: true }

  const takers = [...votes.entries()].filter(([, value]) => value === 'take-now')
  const waiters = values.filter((value) => value === 'wait').length
  if (takers.length === 1 && waiters === values.length - 1) {
    return { state: 'agreed', winner: takers[0][0] }
  }
  if (takers.length === 1 && values.length === 1) {
    return { state: 'agreed', winner: takers[0][0] }
  }

  return { state: 'needs_decision' }
}

export { decideThread, PROPOSALS, MAX_PER_SIDE }