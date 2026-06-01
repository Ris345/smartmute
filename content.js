(function () {
  if (window.__vadInitialized) return;
  window.__vadInitialized = true;

  const STATE = { DISABLED: 'DISABLED', SOFT_MUTED: 'SOFT_MUTED', UNMUTED: 'UNMUTED', HARD_MUTED: 'HARD_MUTED' };

  const FRAME_MS             = 30;
  const SPEECH_THRESHOLD_MS  = 400;
  const SILENCE_THRESHOLD_MS = 2000;

  const NOISE_ADAPT_DOWN = 0.95;
  const NOISE_ADAPT_UP   = 0.97;
  const SNR_MULTIPLIER   = 3.5;
  const MIN_THRESHOLD    = 0.02;

  let currentState  = STATE.SOFT_MUTED;
  let speechMs      = 0;
  let silenceMs     = 0;
  let noiseFloor    = 0.03;
  let vadRunning    = false;
  let userThreshold = null;

  // Exposed for background.js SET_THRESHOLD injection and tests.
  window.__vadSetThreshold = (v) => { userThreshold = v; };

  function clickMicToggle() {
    const candidates = [
      'button[aria-label*="microphone" i]:not([aria-label*="camera" i]):not([aria-label*="video" i])',
      'button[aria-label*="mute" i]:not([aria-label*="camera" i]):not([aria-label*="video" i])',
      '[role="button"][aria-label*="mic" i]:not([aria-label*="camera" i])',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { el.click(); return true; }
    }
    return false;
  }

  function ctrlShiftM() {
    for (const type of ['keydown', 'keyup']) {
      document.dispatchEvent(new KeyboardEvent(type, {
        key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true,
        bubbles: true, cancelable: true,
      }));
    }
  }

  function platformMute() {
    const host = location.hostname;
    if (host.includes('meet.google.com')) {
      document.querySelector('button[aria-label="Turn off microphone"]')?.click();
    } else if (host.includes('zoom.us')) {
      document.querySelector('.join-audio-container__btn')?.click();
    } else if (!clickMicToggle()) {
      ctrlShiftM();
    }
  }

  function platformUnmute() {
    const host = location.hostname;
    if (host.includes('meet.google.com')) {
      document.querySelector('button[aria-label="Turn on microphone"]')?.click();
    } else if (host.includes('zoom.us')) {
      document.querySelector('.join-audio-container__btn')?.click();
    } else if (!clickMicToggle()) {
      ctrlShiftM();
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ ok: true }); return true; }
    if (msg.type === 'SET_STATE') { currentState = msg.state; }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.state) return;
    const { newValue, oldValue } = changes.state;

    if (newValue === STATE.SOFT_MUTED && oldValue === STATE.DISABLED) {
      platformMute();
      if (!vadRunning) init().catch(e => console.error('[VAD] retry failed:', e.message));
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
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const buffer = new Float32Array(analyser.fftSize);
    source.connect(analyser);

    function startLoop() {
      vadRunning = true;
      console.log('[VAD] started, state:', currentState);
      if (currentState === STATE.SOFT_MUTED) platformMute();

      setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);

        const threshold = userThreshold !== null
          ? userThreshold
          : Math.max(MIN_THRESHOLD, noiseFloor * SNR_MULTIPLIER);
        const isSpeech = rms > threshold;

        if (!isSpeech) {
          noiseFloor = rms < noiseFloor
            ? NOISE_ADAPT_DOWN * noiseFloor + (1 - NOISE_ADAPT_DOWN) * rms
            : NOISE_ADAPT_UP   * noiseFloor + (1 - NOISE_ADAPT_UP)   * rms;
        }

        if (isSpeech) {
          speechMs  += FRAME_MS;
          silenceMs  = 0;
        } else {
          silenceMs += FRAME_MS;
          speechMs   = 0;
        }

        if (speechMs >= SPEECH_THRESHOLD_MS && currentState === STATE.SOFT_MUTED) {
          currentState = STATE.UNMUTED;
          speechMs = 0;
          console.log('[VAD] speech → unmuting');
          platformUnmute();
          chrome.runtime.sendMessage({ type: 'VAD_START' });
        }

        if (silenceMs >= SILENCE_THRESHOLD_MS && currentState === STATE.UNMUTED) {
          currentState = STATE.SOFT_MUTED;
          silenceMs = 0;
          console.log('[VAD] silence → muting');
          platformMute();
          chrome.runtime.sendMessage({ type: 'VAD_STOP' });
        }
      }, FRAME_MS);
    }

    audioContext.addEventListener('statechange', () => {
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    });

    if (audioContext.state === 'running') {
      startLoop();
    } else {
      audioContext.resume().catch(() => {});
      const onRunning = () => {
        if (audioContext.state === 'running') {
          audioContext.removeEventListener('statechange', onRunning);
          startLoop();
        }
      };
      audioContext.addEventListener('statechange', onRunning);
      console.log('[VAD] AudioContext suspended — will start on next page interaction');
    }
  }

  init().catch((err) => {
    console.warn('[VAD] init failed, waiting for user gesture:', err.message);
    const onGesture = () => {
      document.removeEventListener('click', onGesture);
      document.removeEventListener('keydown', onGesture);
      if (!vadRunning) init().catch(e => console.error('[VAD] retry failed:', e.message));
    };
    document.addEventListener('click', onGesture);
    document.addEventListener('keydown', onGesture);
  });

})();
