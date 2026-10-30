// Pure decisions for screen/window sharing. Capture (desktopCapturer, getDisplayMedia) and WebRTC
// plumbing live in main/main.js and renderer/app.js; this module only shapes and validates data.

export const MAX_SOURCES = 50
export const MAX_SOURCE_NAME = 200

// Shapes raw desktopCapturer sources into what the picker shows: capped list, bounded label,
// a thumbnail data URL or null. Main lists what it will accept; this never adds an id of its own.
export function shareSources(sources) {
  if (!Array.isArray(sources)) return []
  const result = []
  for (const source of sources) {
    if (result.length >= MAX_SOURCES) break
    if (typeof source?.id !== 'string' || !source.id) continue
    result.push({
      id: source.id,
      name: typeof source.name === 'string' ? source.name.slice(0, MAX_SOURCE_NAME) : '',
      thumbnail: typeof source.thumbnail === 'string' ? source.thumbnail : null,
    })
  }
  return result
}

// A share claims host the same way opening a file does, and plays the "no timeline" role that
// `image: {id}` plays for pictures: `id` is the claim revision as a string. `audio` records
// whether system audio came through (loopback is Windows-only; macOS shares video only).
export function cleanShare(value, claimedAt) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.id !== String(claimedAt)) return null
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > MAX_SOURCE_NAME)) return null
  if (value.audio !== undefined && typeof value.audio !== 'boolean') return null
  return {id: value.id, name: typeof value.name === 'string' ? value.name : '', audio: value.audio === true}
}

// Whether playback controls (play/pause/seek/loop) should be disabled, matching imageMode.
export const hidesTimeline = (share) => Boolean(share)
