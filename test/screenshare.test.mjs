import test from 'node:test'
import assert from 'node:assert/strict'
import {MAX_SOURCES, MAX_SOURCE_NAME, cleanShare, hidesTimeline, shareSources} from '../renderer/screenshare.mjs'

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
