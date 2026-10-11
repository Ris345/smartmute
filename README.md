# SmartMute

A Manifest V3 Chrome extension that auto-mutes and unmutes your microphone on
video conferencing pages using voice activity detection (VAD). Stop forgetting
to unmute when you start talking, or mute when you stop.

Supported platforms: Google Meet, Microsoft Teams, Zoom, Webex, Jitsi Meet,
Whereby, Discord, Skype for Web.

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this project's root directory

No build step is required.

## How it works

1. **content.js** opens a second microphone stream via `getUserMedia` and
   analyzes it every 30ms to detect speech vs. silence, using an adaptive
   noise floor rather than a fixed threshold.
2. On a detected speech/silence transition, it sends `VAD_START` / `VAD_STOP`
   to the background service worker.
3. **background.js** owns the state machine, persists state to
   `chrome.storage.local`, and is the single place responsible for clicking
   the platform's mic button (via `chrome.scripting.executeScript`) in
   response to those messages.
4. **popup.js** shows current state and lets you toggle auto-mute on/off
   (`DISABLED` vs. `SOFT_MUTED`) for the active tab.

### State machine

```
SOFT_MUTED  ←──────────────── VAD_STOP ───────────────┐
     │                                                  │
  VAD_START                                         (mute platform)
     │                                                  │
     └──────────────────► UNMUTED ─────────────────────┘

DISABLED: VAD messages are ignored; the popup toggle is the only escape.
```

Default state on install is `SOFT_MUTED` (auto-mute active, mic off until you
speak).

### VAD tuning

- 400ms of sustained speech triggers unmute; 2000ms of sustained silence
  triggers remute.
- Speech detection: `rms > max(0.02, noiseFloor × 3.5)`.
- The noise floor adapts only during silence, so your voice never pollutes
  the background-noise baseline.

## Development

```bash
npm install
npm test                               # run full Jest suite
npx jest test/background.test.js       # run a single test file
npx jest --testNamePattern "VAD_START" # run tests matching a name
```

See `CLAUDE.md` for detailed architecture notes, known quirks (e.g. the
orphaned AudioWorklet processor), and test-mocking gotchas.
