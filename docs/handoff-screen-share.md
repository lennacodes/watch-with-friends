# Handoff: screen and window sharing (with audio)

For: Lenna's Claude Code. Aya owns the repo; Lenna is building this feature. Read this file once, then work.

## 1. Get the repo

```sh
gh repo fork onlineslav/watch-with-friends --clone   # or: git clone, if Lenna has write access
cd watch-with-friends
git checkout -b feature/screen-share
npm install        # also patches Trystero (scripts/patch-trystero.js)
npm test           # must pass before you change anything
npm start          # bundles renderer, launches Electron
```

Needs Node LTS and git. In a VS Code terminal `ELECTRON_RUN_AS_NODE=1` is set; `npm start` handles it.

## 2. Keep token use low (Aya's hard rule)

- `CLAUDE.md` is loaded automatically and is the architecture map. Trust it; don't re-explore the codebase.
- **Never read `renderer/bundle.js`** (generated, huge). **Never read `renderer/app.js` whole** (~3.7k lines):
  Grep for a symbol, then Read only that range.
- No subagents unless Lenna asks. At most one at a time.
- Targeted tests per step (`node --test test/<file>`); the full `npm test` once at the end.
- Decide small, reversible things yourself and say what you picked. Ask Lenna only for design changes
  or anything hard to undo. One feature, one conversation; stop when it's done.

## 3. What to build

The host can share a whole screen or one application window, with audio, instead of opening a file.
Viewers see and hear it through the same WebRTC path a file uses.

Start here (all in `CLAUDE.md` too):

- `renderer/app.js` `publishStream()` / `unpublishStream()` (grep them): builds the host's `MediaStream`
  and adds it to the room with `{metadata: {claimedAt}}`, then `tuneSenders()`. A screen share should
  produce its own stream and go through the same add/remove/republish path.
- Opening a file claims host (`claimedAt`, `isNewerClaim`). Starting a share claims host the same way.
- Pictures are the precedent for "no timeline": `state` carries `image: {id}` and `control` ignores
  play/seek/loop. Do the same for a share (e.g. `screen: {id}`), and hide seek/loop UI while sharing.
- `renderer/protocol.mjs` validates incoming data: add the new state field there, with tests.
- `main/main.js`: add the capture handler and an IPC call for the source list.

Electron approach (verify against the installed Electron's docs before writing):

1. Main: `session.defaultSession.setDisplayMediaRequestHandler` + `desktopCapturer.getSources({types:
   ['screen','window'], thumbnailSize})`. Renderer: `navigator.mediaDevices.getDisplayMedia({video:
   true, audio: true})`.
2. Our own picker in the renderer (source name + thumbnail grid); main resolves the request with the
   chosen source. Main only accepts a source id it listed itself.
3. Audio: `audio: 'loopback'` in the handler callback gives **system** audio on Windows, not per-window.
   macOS support depends on the Electron/macOS version; check, and if unavailable share video only and
   tell the user in the UI. Loopback includes this app's own reaction sounds; acceptable, note it.
4. Set `track.contentHint = 'detail'` for screens (text stays sharp), `'motion'` is for films.
   Keep H.264 first (`setCodecPreferences`) and `tuneSenders` caps as they are.
5. Stopping: a Stop button, plus the track's `ended` event (window closed, OS stop). Both unpublish and
   return the room to idle. Switching source = stop + start.

Put pure decisions (picker list shaping, state validation, which UI is enabled while sharing) in a new
pure module, e.g. `renderer/screenshare.mjs`, with `test/screenshare.test.mjs`, matching how
`whiteboard.mjs` / `reactions.mjs` are tested.

## 4. Don't break these

- Don't change `APP_ID` (app.js), `helloText` (friends.mjs) or `build.appId`: they're on the wire /
  installer identity. Older builds must still connect; an unknown `screen` field must not crash them.
- Telemetry freeze counting (`nextSteady`) assumes film playback; make sure a static screen isn't
  reported as freezes.
- Whiteboard, reactions, subtitles-off and the playlist keep working while a share is live; the
  playlist should not auto-advance during a share.
- Re-run `npm run bundle` after any edit in `renderer/` or `shared/`.

## 5. Done means

1. `npm test` passes; new pure module has unit tests.
2. Manual check with two app instances (two PCs, or a second profile): share screen, share a window,
   audio heard on the viewer, stop via button and by closing the window, host handover still works.
3. If practical, extend `npm run test:network` with a fake display source; skip if it costs more
   than ~1 hour and say so in the PR.
4. Add one **Screen sharing** bullet to the Architecture section of `CLAUDE.md` (same style as the others).
5. Commit in small steps with clear messages; push the branch; open a PR to `onlineslav/watch-with-friends`
   `main` with what works, what was tested, what's rough (e.g. macOS audio). Aya reviews and releases;
   don't bump the version or run `dist:*` publishing.
