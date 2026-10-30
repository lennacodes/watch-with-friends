import test from 'node:test'
import assert from 'node:assert/strict'
import {MAX_SOURCES, MAX_SOURCE_NAME, cleanShare, hidesTimeline, shareSources, RESOLUTIONS, FRAME_RATES, DEFAULT_RESOLUTION, DEFAULT_FRAME_RATE, shareVideoConstraints, audioInputs, windowIdFromSource} from '../renderer/screenshare.mjs'

test('shareSources shapes raw desktopCapturer output for the picker and drops junk entries', () => {
  const raw = [
    {id: 'screen:0:0', name: 'Entire Screen', thumbnail: 'data:image/png;base64,AA=='},
    {id: 'window:123:0', name: 'x'.repeat(300), thumbnail: null},
    {id: '', name: 'No id'},
    {name: 'Missing id entirely'},
    null,
  ]
  const shaped = shareSources(raw)
  assert.deepEqual(shaped, [
    {id: 'screen:0:0', name: 'Entire Screen', thumbnail: 'data:image/png;base64,AA=='},
    {id: 'window:123:0', name: 'x'.repeat(MAX_SOURCE_NAME), thumbnail: null},
  ])
})

test('shareSources caps the list and tolerates non-array input', () => {
  const many = Array.from({length: MAX_SOURCES + 10}, (_, i) => ({id: `window:${i}:0`, name: String(i), thumbnail: null}))
  assert.equal(shareSources(many).length, MAX_SOURCES)
  assert.deepEqual(shareSources(null), [])
  assert.deepEqual(shareSources(undefined), [])
  assert.deepEqual(shareSources('nope'), [])
})

test('cleanShare accepts a share whose id matches the claim revision and rejects everything else', () => {
  assert.deepEqual(cleanShare({id: '42', name: 'Entire Screen', audio: true}, 42), {id: '42', name: 'Entire Screen', audio: true})
  assert.equal(cleanShare(null, 42), null)
  assert.equal(cleanShare(undefined, 42), null)
  for (const bad of [{id: '41'}, {id: 42}, {}, {id: '42', name: 'x'.repeat(MAX_SOURCE_NAME + 1)}, {id: '42', audio: 'yes'}, 'nope', 5]) {
    assert.equal(cleanShare(bad, 42), null, JSON.stringify(bad))
  }
})

test('cleanShare defaults a missing name and audio flag rather than rejecting the share', () => {
  assert.deepEqual(cleanShare({id: '1'}, 1), {id: '1', name: '', audio: false})
})

test('hidesTimeline is true exactly when a share is active, matching how pictures hide it', () => {
  assert.equal(hidesTimeline({id: '1', name: '', audio: false}), true)
  assert.equal(hidesTimeline(null), false)
  assert.equal(hidesTimeline(undefined), false)
})

test('shareVideoConstraints maps a resolution/frame rate pair to getDisplayMedia-shaped constraints', () => {
  assert.deepEqual(shareVideoConstraints('1080', 60), {
    frameRate: {ideal: 60, max: 60},
    width: {ideal: 1920, max: 1920},
    height: {ideal: 1080, max: 1080},
  })
  assert.deepEqual(shareVideoConstraints('2160', 120), {
    frameRate: {ideal: 120, max: 120},
    width: {ideal: 3840, max: 3840},
    height: {ideal: 2160, max: 2160},
  })
})

test('shareVideoConstraints leaves width/height unset for native resolution', () => {
  const constraints = shareVideoConstraints('native', 30)
  assert.deepEqual(constraints, {frameRate: {ideal: 30, max: 30}})
})

test('shareVideoConstraints falls back to native resolution and the default frame rate for nonsense input', () => {
  assert.deepEqual(shareVideoConstraints('bogus', 999), {frameRate: {ideal: DEFAULT_FRAME_RATE, max: DEFAULT_FRAME_RATE}})
  assert.deepEqual(shareVideoConstraints(undefined, undefined), {frameRate: {ideal: DEFAULT_FRAME_RATE, max: DEFAULT_FRAME_RATE}})
  assert.equal(DEFAULT_RESOLUTION, 'native')
  assert.ok(RESOLUTIONS.some((r) => r.value === DEFAULT_RESOLUTION))
  assert.ok(FRAME_RATES.includes(DEFAULT_FRAME_RATE))
})

test('audioInputs keeps only audio input devices with a real id, and tolerates a missing label', () => {
  const devices = [
    {kind: 'audioinput', deviceId: 'mic1', label: 'Built-in Microphone'},
    {kind: 'audiooutput', deviceId: 'speaker1', label: 'Speakers'},
    {kind: 'videoinput', deviceId: 'cam1', label: 'Camera'},
    {kind: 'audioinput', deviceId: '', label: 'No id'},
    {kind: 'audioinput', deviceId: 'blackhole', label: ''},
  ]
  assert.deepEqual(audioInputs(devices), [
    {deviceId: 'mic1', label: 'Built-in Microphone'},
    {deviceId: 'blackhole', label: 'Microphone'},
  ])
})

test('windowIdFromSource extracts the numeric CGWindowID from a window source, and rejects everything else', () => {
  assert.equal(windowIdFromSource('window:12345:0'), 12345)
  assert.equal(windowIdFromSource('window:0:0'), 0)
  for (const bad of ['screen:0:0', 'window:abc:0', 'window:12345', 'window:-1:0', null, undefined, 5, '']) {
    assert.equal(windowIdFromSource(bad), null, JSON.stringify(bad))
  }
})

test('audioInputs caps the list and tolerates non-array input', () => {
  const many = Array.from({length: 60}, (_, i) => ({kind: 'audioinput', deviceId: `mic${i}`, label: `Mic ${i}`}))
  assert.equal(audioInputs(many).length, 50)
  assert.deepEqual(audioInputs(null), [])
  assert.deepEqual(audioInputs(undefined), [])
})
