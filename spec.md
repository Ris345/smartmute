# SmartMute Chrome Extension — v1.0 Spec

## State Machine
HARD_MUTED → (user toggles popup) → SOFT_MUTED → (1s speech) → UNMUTED → (2s silence) → SOFT_MUTED

## Timing Constants
SPEECH_TRIGGER_MS = 1000   # continuous speech before unmute
SILENCE_TRIGGER_MS = 2000  # continuous silence before re-mute
VAD_FRAME_MS = 30          # AudioWorklet frame size
RMS_THRESHOLD = 0.015      # default sensitivity (0.0–1.0)

## Files
- manifest.json         # MV3, permissions
- background.js         # service worker, state machine, message bus
- content.js            # injected script, mic capture, DOM unmute
- audio-processor.js    # AudioWorkletProcessor, RMS VAD
- popup.html            # UI: hard mute toggle, sensitivity slider
- popup.js              # popup logic

## Supported Platforms
- meet.google.com       → click '[data-is-muted="true"]'
- teams.microsoft.com   → dispatch Ctrl+Shift+M
- zoom.us (web)         → click '.join-audio-container__btn'
- fallback              → dispatch Ctrl+Shift+M

## Messages (chrome.runtime)
content → background:  { type: 'VAD_START' | 'VAD_STOP' | 'STATE_REQUEST' }
background → content:  { type: 'SET_STATE', state: 'HARD_MUTED' | 'SOFT_MUTED' | 'UNMUTED' }
popup → background:    { type: 'HARD_MUTE_TOGGLE' | 'SET_THRESHOLD', value?: number }

## AudioWorklet Contract
- Input: raw PCM float32 frames
- Output: postMessage({ rms: float, isSpeech: bool })
- isSpeech = rollingRMS > threshold for current frame
- Timing accumulation happens in content.js, NOT in worklet