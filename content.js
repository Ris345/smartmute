const STATE = { HARD_MUTED: 'HARD_MUTED', SOFT_MUTED: 'SOFT_MUTED', UNMUTED: 'UNMUTED' };

const FRAME_MS = 30;
const SPEECH_THRESHOLD_MS = 1000;
const SILENCE_THRESHOLD_MS = 3000;

const NOISE_ADAPT_DOWN = 0.95;
const NOISE_ADAPT_UP   = 0.999;
const SNR_MULTIPLIER   = 3.0;

let currentState = STATE.SOFT_MUTED;
let speechMs = 0;
let silenceMs = 0;
let threshold  = 0.015;
let noiseFloor = 0.02;

globalThis.__vadSetThreshold = (v) => { threshold = v; };

function platformMute() {
  const host = location.hostname;
  if (host.includes('meet.google.com')) {
    document.querySelector('button[aria-label="Turn off microphone"]')?.click();
  } else if (host.includes('zoom.us')) {
    document.querySelector('.join-audio-container__btn')?.click();
  } else {
    for (const type of ['keydown', 'keyup']) {
      document.dispatchEvent(new KeyboardEvent(type, {
        key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true,
        bubbles: true, cancelable: true,
      }));
    }
  }
}

function platformUnmute() {
  const host = location.hostname;
  if (host.includes('meet.google.com')) {
    document.querySelector('button[aria-label="Turn on microphone"]')?.click();
  } else if (host.includes('zoom.us')) {
    document.querySelector('.join-audio-container__btn')?.click();
  } else {
    for (const type of ['keydown', 'keyup']) {
      document.dispatchEvent(new KeyboardEvent(type, {
        key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true,
        bubbles: true, cancelable: true,
      }));
    }
  }
}

// Use storage.onChanged instead of tabs.sendMessage — storage changes are guaranteed
// to be delivered to all extension contexts, no tabs permission or message routing needed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return;
  const { newValue, oldValue } = changes.state;

  if (newValue === STATE.HARD_MUTED) {
    platformMute();
  } else if (oldValue === STATE.HARD_MUTED) {
    platformUnmute();
  }

  currentState = newValue;
});

async function init() {
  const stored = await new Promise(resolve => chrome.storage.local.get('state', resolve));
  if (stored.state) currentState = stored.state;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  const audioContext = new AudioContext();
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  const buffer = new Float32Array(analyser.fftSize);
  source.connect(analyser);

  setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / buffer.length);

    noiseFloor = rms < noiseFloor
      ? NOISE_ADAPT_DOWN * noiseFloor + (1 - NOISE_ADAPT_DOWN) * rms
      : NOISE_ADAPT_UP   * noiseFloor + (1 - NOISE_ADAPT_UP)   * rms;

    const isSpeech = rms > Math.max(threshold, noiseFloor * SNR_MULTIPLIER);

    if (isSpeech) {
      speechMs += FRAME_MS;
      silenceMs = 0;
    } else {
      silenceMs += FRAME_MS;
      speechMs = 0;
    }

    if (speechMs >= SPEECH_THRESHOLD_MS && currentState === STATE.SOFT_MUTED) {
      currentState = STATE.UNMUTED;
      speechMs = 0;
      platformUnmute();
      chrome.runtime.sendMessage({ type: 'VAD_START' });
    }

    if (silenceMs >= SILENCE_THRESHOLD_MS && currentState === STATE.UNMUTED) {
      currentState = STATE.SOFT_MUTED;
      silenceMs = 0;
      platformMute();
      chrome.runtime.sendMessage({ type: 'VAD_STOP' });
    }
  }, FRAME_MS);
}

init().catch((err) => {
  console.error('[VAD] init failed, waiting for user gesture:', err);
  const onFirstGesture = () => {
    document.removeEventListener('click', onFirstGesture);
    document.removeEventListener('keydown', onFirstGesture);
    init().catch(console.error);
  };
  document.addEventListener('click', onFirstGesture);
  document.addEventListener('keydown', onFirstGesture);
});
