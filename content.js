(function () {
  if (window.__vadInitialized) return;
  window.__vadInitialized = true;

  const STATE = { DISABLED: 'DISABLED', SOFT_MUTED: 'SOFT_MUTED', UNMUTED: 'UNMUTED' };

  const FRAME_MS = 30;
  const SPEECH_THRESHOLD_MS = 400;   // 0.4s of consecutive speech to unmute (was 0.2s)
  const SILENCE_THRESHOLD_MS = 2000; // 2s of silence to re-mute

  // Noise floor adapts DOWN quickly (quiet room) and UP quickly (background noise appears).
  // Was: ADAPT_UP = 0.999 → ~90s to catch up. Now 0.97 → ~1s time constant.
  const NOISE_ADAPT_DOWN = 0.95;
  const NOISE_ADAPT_UP   = 0.97;
  const SNR_MULTIPLIER   = 3.5;   // speech must be 3.5× noise floor (was 2.5)
  const MIN_THRESHOLD    = 0.02;  // absolute RMS floor (was 0.01)

  let currentState = STATE.SOFT_MUTED;
  let speechMs = 0;
  let silenceMs = 0;
  let noiseFloor = 0.03;  // start higher so early transients don't immediately fire (was 0.02)
  let vadRunning = false;

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
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.state) return;
    const { newValue, oldValue } = changes.state;

    if (newValue === STATE.SOFT_MUTED && oldValue === STATE.DISABLED) {
      platformMute();
      // VAD may never have started (e.g. getUserMedia failed at page load).
      // Retry now that the user has deliberately turned auto-mute ON.
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

        const threshold = Math.max(MIN_THRESHOLD, noiseFloor * SNR_MULTIPLIER);
        const isSpeech = rms > threshold;

        // Only update the noise floor during non-speech frames so speech energy
        // doesn't inflate the floor and hide future speech from detection.
        if (!isSpeech) {
          noiseFloor = rms < noiseFloor
            ? NOISE_ADAPT_DOWN * noiseFloor + (1 - NOISE_ADAPT_DOWN) * rms
            : NOISE_ADAPT_UP   * noiseFloor + (1 - NOISE_ADAPT_UP)   * rms;
        }

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

    // Keep the context alive if suspended mid-session.
    audioContext.addEventListener('statechange', () => {
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    });

    if (audioContext.state === 'running') {
      startLoop();
    } else {
      // AudioContext is suspended (no user gesture on this page yet).
      // Don't throw — just wait for it to become running, which happens
      // automatically on the next user interaction with the page.
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

  // Auto-injected at page load. getUserMedia may fail here if the user hasn't
  // joined the meeting yet (no mic permission). The storage-change listener
  // above will retry when the user toggles auto-mute ON from the popup.
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
