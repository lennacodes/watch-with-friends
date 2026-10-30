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
// ScreenCaptureKit can report a stream started successfully and then silently deliver nothing —
// the known failure mode when this binary hasn't been separately granted Screen & System Audio
// Recording permission (it's a distinct executable from the main app, with its own TCC entry).
// Treat that as a real failure instead of a share that's just quiet.
const SILENCE_TIMEOUT_MS = 5000

const sessions = new Map()
let nextSessionId = 1

// Resolves once the helper's first stderr line confirms capture actually started ("ready"), or
// rejects with its error line (e.g. the window closed, or Screen Recording permission is
// missing). Only a resolved session is worth pulling from.
function startSession(windowId) {
  if (process.platform !== 'darwin') return Promise.reject(new Error('App audio capture is only available on macOS'))
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath(), [String(windowId)], {stdio: ['ignore', 'pipe', 'pipe']})
    const session = {proc, chunks: [], size: 0, done: false, killed: false, error: null, waiter: null, bytesReceived: 0}
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
        session.silenceTimer = setTimeout(() => {
          if (session.receivedAnyData || session.done) return
          session.error = 'No audio arrived within 5s of starting — check that the shared app is actually making sound, and that mac-app-audio has Screen & System Audio Recording permission in System Settings > Privacy & Security.'
          session.done = true
          wake()
        }, SILENCE_TIMEOUT_MS)
        resolve({id})
      } else {
        proc.kill()
        reject(new Error(line.replace(/^error:\s*/, '') || 'mac-app-audio failed to start'))
      }
    })
    proc.stdout.on('data', (buf) => {
      if (!session.receivedAnyData) {
        session.receivedAnyData = true
        clearTimeout(session.silenceTimer)
      }
      session.bytesReceived += buf.length
      session.chunks.push(buf)
      session.size += buf.length
      if (session.size > HIGH_WATER_BYTES) proc.stdout.pause()
      wake()
    })
    proc.on('error', (err) => {
      clearTimeout(session.silenceTimer)
      session.error = err.message
      session.done = true
      wake()
      if (!settled) {
        settled = true
        reject(err)
      }
    })
    proc.on('close', (code, signal) => {
      clearTimeout(session.silenceTimer)
      session.done = true
      session.exitSignal = signal
      if (code !== 0 && !session.killed && !session.error) {
        // code is null when a signal killed the process (a crash, not a normal exit): macOS
        // writes a full stack trace for that to DiagnosticReports, which this can only point at.
        session.error = signal
          ? `mac-app-audio was killed by ${signal} (likely a crash) — check ~/Library/Logs/DiagnosticReports/mac-app-audio-*.ips for the stack trace.`
          : `mac-app-audio exited with code ${code}`
      }
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
    // Flagged once per session so main.js can log the single most diagnostic fact here: whether
    // real capture ever actually happened, not just "no error yet".
    const first = !session.loggedFirstChunk
    session.loggedFirstChunk = true
    const parts = []
    let taken = 0
    while (session.chunks.length && taken < MAX_PULL_BYTES) {
      const chunk = session.chunks.shift()
      parts.push(chunk)
      taken += chunk.length
    }
    session.size -= taken
    if (session.size < HIGH_WATER_BYTES / 2) session.proc.stdout.resume()
    return {chunk: Buffer.concat(parts, taken), first}
  }
  sessions.delete(id)
  return {done: true, error: session.error, bytesReceived: session.bytesReceived, exitSignal: session.exitSignal}
}

function stopSession(id) {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  clearTimeout(session.silenceTimer)
  session.killed = true
  session.proc.kill()
  session.wake()
}

function stopAll() {
  for (const id of [...sessions.keys()]) stopSession(id)
}

module.exports = {startSession, pull, stopSession, stopAll}
