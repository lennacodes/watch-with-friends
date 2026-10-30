// Spawns native/mac-app-audio, which captures one running application's audio via
// ScreenCaptureKit (a content filter scoped to that app) and writes raw interleaved Float32 PCM
// to stdout. Session/pull/stop mirror media.js's ffmpeg sessions on purpose: pulling is what
// applies backpressure, same reason.
const path = require('node:path')
const {spawn} = require('node:child_process')
const {app} = require('electron')

const binaryPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'mac-app-audio') : path.join(__dirname, '..', 'native', 'mac-app-audio', 'mac-app-audio')

const HIGH_WATER_BYTES = 4 * 1024 * 1024
const MAX_PULL_BYTES = 1024 * 1024

const sessions = new Map()
let nextSessionId = 1

// Resolves once the helper's first stderr line confirms capture actually started ("ready"), or
// rejects with its error line (e.g. the window closed, or Screen Recording permission is
// missing). Only a resolved session is worth pulling from.
function startSession(windowId) {
  if (process.platform !== 'darwin') return Promise.reject(new Error('App audio capture is only available on macOS'))
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath(), [String(windowId)], {stdio: ['ignore', 'pipe', 'pipe']})
    const session = {proc, chunks: [], size: 0, done: false, killed: false, error: null, waiter: null}
    const wake = () => {
      const waiter = session.waiter
      session.waiter = null
      waiter?.()
    }
    session.wake = wake

    let settled = false
    let stderrFirstLine = ''
    proc.stderr.on('data', (buf) => {
      if (settled) return
      if (!stderrFirstLine.includes('\n')) stderrFirstLine += buf.toString('utf8')
      const newlineAt = stderrFirstLine.indexOf('\n')
      if (newlineAt === -1) return
      const line = stderrFirstLine.slice(0, newlineAt).trim()
      settled = true
      if (line === 'ready') {
        const id = nextSessionId++
        sessions.set(id, session)
        resolve({id})
      } else {
        proc.kill()
        reject(new Error(line.replace(/^error:\s*/, '') || 'mac-app-audio failed to start'))
      }
    })
    proc.stdout.on('data', (buf) => {
      session.chunks.push(buf)
      session.size += buf.length
      if (session.size > HIGH_WATER_BYTES) proc.stdout.pause()
      wake()
    })
    proc.on('error', (err) => {
      session.error = err.message
      session.done = true
      wake()
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    proc.on('close', (code) => {
      session.done = true
      if (code !== 0 && !session.killed && !session.error) session.error = `mac-app-audio exited with code ${code}`
      wake()
      if (!settled) {
        settled = true
        reject(new Error(session.error || 'mac-app-audio exited before starting'))
      }
    })
  })
}

async function pull(id) {
  const session = sessions.get(id)
  if (!session) return {done: true}
  while (!session.size && !session.done && !session.killed) {
    await new Promise((resolve) => (session.waiter = resolve))
  }
  if (session.killed) return {done: true}
  if (session.size) {
    const parts = []
    let taken = 0
    while (session.chunks.length && taken < MAX_PULL_BYTES) {
      const chunk = session.chunks.shift()
      parts.push(chunk)
      taken += chunk.length
    }
    session.size -= taken
    if (session.size < HIGH_WATER_BYTES / 2) session.proc.stdout.resume()
    return {chunk: Buffer.concat(parts, taken)}
  }
  sessions.delete(id)
  return {done: true, error: session.error}
}

function stopSession(id) {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.killed = true
  session.proc.kill()
  session.wake()
}

function stopAll() {
  for (const id of [...sessions.keys()]) stopSession(id)
}

module.exports = {startSession, pull, stopSession, stopAll}
