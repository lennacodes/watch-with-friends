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
// whether any audio track came through: Windows loopback, or a chosen input device on any platform.
export function cleanShare(value, claimedAt) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.id !== String(claimedAt)) return null
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > MAX_SOURCE_NAME)) return null
  if (value.audio !== undefined && typeof value.audio !== 'boolean') return null
  return {id: value.id, name: typeof value.name === 'string' ? value.name : '', audio: value.audio === true}
}

// Whether playback controls (play/pause/seek/loop) should be disabled, matching imageMode.
export const hidesTimeline = (share) => Boolean(share)

// Offered in Settings, and as the constraints passed to getDisplayMedia/applyConstraints.
// Native omits width/height so the capture isn't scaled at all.
export const RESOLUTIONS = [
  {value: 'native', label: 'Native (no scaling)'},
  {value: '2160', label: '4K (3840×2160)', width: 3840, height: 2160},
  {value: '1440', label: '1440p (2560×1440)', width: 2560, height: 1440},
  {value: '1080', label: '1080p (1920×1080)', width: 1920, height: 1080},
  {value: '720', label: '720p (1280×720)', width: 1280, height: 720},
]
export const FRAME_RATES = [15, 24, 30, 60, 120]
export const DEFAULT_RESOLUTION = 'native'
export const DEFAULT_FRAME_RATE = 30

// Shapes a resolution/frame rate preference into getDisplayMedia's video constraints, or
// MediaStreamTrack.applyConstraints() for a live change. Falls back silently on nonsense input
// (a stale localStorage value, say) rather than throwing.
export function shareVideoConstraints(resolution, frameRate) {
  const match = RESOLUTIONS.find((r) => r.value === resolution) || RESOLUTIONS[0]
  const fps = FRAME_RATES.includes(frameRate) ? frameRate : DEFAULT_FRAME_RATE
  return {
    frameRate: {ideal: fps, max: fps},
    ...(match.width && {width: {ideal: match.width, max: match.width}, height: {ideal: match.height, max: match.height}}),
  }
}

// Shapes enumerateDevices() output for the audio-source picker: only real audio inputs (a
// microphone, or a virtual device like BlackHole that mirrors system/app audio on macOS).
export function audioInputs(devices) {
  if (!Array.isArray(devices)) return []
  return devices
    .filter((d) => d?.kind === 'audioinput' && typeof d.deviceId === 'string' && d.deviceId)
    .slice(0, 50)
    .map((d) => ({deviceId: d.deviceId, label: typeof d.label === 'string' && d.label ? d.label.slice(0, 200) : 'Microphone'}))
}
