import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVICE_FILE = join(homedir(), '.config/opencode/service.json')

const credentials = () => {
  try {
    const raw = JSON.parse(readFileSync(SERVICE_FILE, 'utf8'))
    return raw.password ? { user: 'opencode', password: raw.password } : null
  } catch {
    return null
  }
}

const serverUrl = () => {
  if (process.env.KANSO_OPENCODE_URL) return process.env.KANSO_OPENCODE_URL
  try {
    return execFileSync('opencode', ['service', 'status'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const authHeader = () => {
  const creds = credentials()
  if (!creds) return {}
  const token = Buffer.from(`${creds.user}:${creds.password}`).toString('base64')
  return { Authorization: `Basic ${token}` }
}

const sendPrompt = async (sessionId, text, { delivery = 'queue' } = {}) => {
  const base = serverUrl()
  if (!base) return { ok: false, code: 'no_server' }
  try {
    const response = await fetch(`${base}/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ text, delivery }),
    })
    if (!response.ok) return { ok: false, code: `http_${response.status}` }
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'unreachable', error: String(error) }
  }
}

export { sendPrompt, serverUrl }