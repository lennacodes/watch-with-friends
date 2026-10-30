// Compiles native/mac-app-audio/main.swift into a standalone per-app audio capture helper
// (ScreenCaptureKit). Built from source on the fly, not vendored, since it's this project's own
// code; needs macOS 13+, where Apple added app-scoped audio capture without a kernel extension.
const fs = require('node:fs')
const path = require('node:path')
const {execFileSync} = require('node:child_process')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'native/mac-app-audio/main.swift')
const defaultTarget = path.join(root, 'native/mac-app-audio/mac-app-audio')
const run = (tool, args) => execFileSync(tool, args, {stdio: 'inherit'})

function build(arch = process.arch, target = defaultTarget) {
  if (process.platform !== 'darwin') throw new Error('Build mac-app-audio on macOS')
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported Mac architecture')
  fs.mkdirSync(path.dirname(target), {recursive: true})
  run('/usr/bin/swiftc', [
    '-O',
    '-target', arch === 'x64' ? 'x86_64-apple-macos13' : 'arm64-apple-macos13',
    source, '-o', target,
    '-framework', 'ScreenCaptureKit', '-framework', 'CoreMedia',
  ])
  run('/usr/bin/codesign', ['--force', '--sign', '-', target])
  console.log(`Built mac-app-audio for ${arch}`)
  return {target}
}

// For dev (npm start): build once, for this machine's own architecture, and skip silently on
// non-Mac or once it's already up to date, rather than recompiling on every single launch.
function buildIfNeeded() {
  if (process.platform !== 'darwin') return
  if (fs.existsSync(defaultTarget) && fs.statSync(defaultTarget).mtimeMs > fs.statSync(source).mtimeMs) return
  build()
}

if (require.main === module) {
  try {
    if (process.argv[2] === '--if-needed') buildIfNeeded()
    else build(process.argv[2])
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
module.exports = {build, buildIfNeeded}
