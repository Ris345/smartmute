# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                              # run all Jest tests (verbose)
npx jest test/background.test.js      # run a single test file
npx jest --testNamePattern "VAD_START" # run tests matching a name
```

No build step — this is a Chrome extension loaded directly as unpacked from the project root (`chrome://extensions` → Load unpacked).

## Architecture

This is a Manifest V3 Chrome extension that auto-mutes/unmutes the user's microphone on video conferencing pages using voice activity detection (VAD).

### Data flow

1. **content.js** captures a second mic stream via `getUserMedia`, analyzes it with `AnalyserNode.getFloatTimeDomainData()` in a `setInterval(30ms)` loop, and sends `VAD_START` / `VAD_STOP` to the background service worker when speech/silence thresholds are crossed.
2. **background.js** owns the state machine. On `VAD_START`/`VAD_STOP` it updates `chrome.storage.local` and fires `chrome.scripting.executeScript` to click the platform mic button in the active tab.
3. **popup.js** reads state from storage on open and listens for `SET_STATE` messages. The single button toggles between `DISABLED` and `SOFT_MUTED` via `AUTO_TOGGLE`.

### State machine (background.js)

```
SOFT_MUTED  ←──────────────── VAD_STOP ───────────────┐
     │                                                  │
  VAD_START                                         (mute platform)
     │                                                  │
     └──────────────────► UNMUTED ─────────────────────┘

DISABLED: VAD messages are ignored; AUTO_TOGGLE is the only escape.
SOFT_MUTED ↔ DISABLED via AUTO_TOGGLE (popup button).
```

Default state on first install is `SOFT_MUTED` (auto-mute active, mic off).

### VAD algorithm (content.js)

RMS is computed over a 1024-sample `Float32Array` every 30 ms. Speech detection uses an adaptive noise floor:

- Noise floor only updates during **non-speech frames** — speech frames must not contaminate the baseline.
- Floor rises toward background noise at rate `NOISE_ADAPT_UP = 0.97` (~1 s time constant).
- Floor drops during silence at rate `NOISE_ADAPT_DOWN = 0.95`.
- `isSpeech = rms > max(MIN_THRESHOLD, noiseFloor × SNR_MULTIPLIER)` — currently `max(0.02, noiseFloor × 3.5)`.
- 400 ms of consecutive speech triggers unmute; 2000 ms of consecutive silence triggers remute.

### AudioContext / start-up behaviour

content.js is auto-injected at page load via `content_scripts` in `manifest.json`, which means `getUserMedia` may fail before the user has joined the meeting and granted mic permission. Two recovery paths exist:

1. **Gesture fallback** — `click`/`keydown` listeners on the page retry `init()`.
2. **Toggle-on retry** — the `chrome.storage.onChanged` listener calls `init()` when state transitions `DISABLED → SOFT_MUTED` (user turning auto-mute back on from the popup), if `vadRunning` is still false.

AudioContext may be suspended (Chrome autoplay policy) even after injection. `init()` does **not** throw in this case — it registers a `statechange` listener and calls `startLoop()` when the context reaches `'running'`.

### audio-processor.js

`VADProcessor` (AudioWorkletProcessor) is **orphaned** — it is no longer used by content.js because Google Meet's CSP blocks `addModule()` for `chrome-extension://` URLs. The file and its tests (`test/vad-processor.test.js`) are kept for reference but do not affect runtime behavior.

### Tests

`test/background.test.js` — state machine transitions, `chrome.storage` and `chrome.scripting` calls.  
`test/content.test.js` — VAD accumulator logic; mocks `AudioContext`, `setInterval`, and `navigator.mediaDevices`. The mock **must** include `state: 'running'` and `addEventListener` on the AudioContext return value, otherwise `startLoop()` is never reached and all VAD assertions will fail.  
`test/vad-processor.test.js` — pure RMS math for the orphaned AudioWorklet processor.

`FRAMES_TO_TRIGGER` in content.test.js must equal `Math.ceil(SPEECH_THRESHOLD_MS / FRAME_MS)`. If either constant changes, update the test constant to match.
