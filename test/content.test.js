// Tests for content.js — VAD accumulator logic and state guards

const flush = () => new Promise(r => setImmediate(r));

const SPEECH_FRAMES  = Math.ceil(400  / 30); // 14 — ceil(SPEECH_THRESHOLD_MS / FRAME_MS)
const SILENCE_FRAMES = Math.ceil(2000 / 30); // 67 — ceil(SILENCE_THRESHOLD_MS / FRAME_MS)
const RMS_SPEECH  = 0.15;  // above effective initial threshold (noiseFloor 0.03 × SNR 3.5 = 0.105)
const RMS_SILENCE = 0.001; // below default threshold

describe('content.js VAD accumulator', () => {
  let simulateFrames;
  let sendMessage;
  let setContentState;

  beforeEach(async () => {
    jest.resetModules();
    sendMessage = jest.fn();

    let intervalCallback;
    global.setInterval = jest.fn((fn) => { intervalCallback = fn; return 1; });

    const mockAnalyser = {
      fftSize: 0,
      getFloatTimeDomainData: jest.fn(buf => buf.fill(RMS_SILENCE)),
      connect: jest.fn(),
    };

    global.AudioContext = jest.fn().mockReturnValue({
      state: 'running',
      resume: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      createMediaStreamSource: jest.fn().mockReturnValue({ connect: jest.fn() }),
      createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
    });

    global.navigator = {
      mediaDevices: { getUserMedia: jest.fn().mockResolvedValue({}) },
    };

    global.location = { hostname: '' };
    global.KeyboardEvent = jest.fn();
    global.document = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      querySelector: jest.fn().mockReturnValue(null),
      dispatchEvent: jest.fn(),
    };

    // Allow window.xxx = ... and reset between tests
    global.window = global;
    delete global.__vadInitialized;
    delete global.__vadSetThreshold;

    let contentMessageListener;
    global.chrome = {
      runtime: {
        sendMessage,
        onMessage: { addListener: jest.fn(fn => { contentMessageListener = fn; }) },
      },
      storage: {
        local: { get: jest.fn((key, cb) => cb({})) },
        onChanged: { addListener: jest.fn() },
      },
    };

    require('../content.js');
    await flush();

    simulateFrames = (count, isSpeech) => {
      const rms = isSpeech ? RMS_SPEECH : RMS_SILENCE;
      mockAnalyser.getFloatTimeDomainData.mockImplementation(buf => buf.fill(rms));
      for (let i = 0; i < count; i++) intervalCallback();
    };

    setContentState = (state) => contentMessageListener({ type: 'SET_STATE', state });
  });

  // ─── Speech accumulator ──────────────────────────────────────────────────────

  describe('speech accumulator', () => {
    test('sends VAD_START after sustained speech in SOFT_MUTED', () => {
      simulateFrames(SPEECH_FRAMES, true);
      expect(sendMessage).toHaveBeenCalledWith({ type: 'VAD_START' });
    });

    test('does not fire before threshold is reached', () => {
      simulateFrames(SPEECH_FRAMES - 1, true);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('speechMs resets on any silence frame, requiring full count again', () => {
      simulateFrames(SPEECH_FRAMES - 1, true);
      simulateFrames(1, false);                      // reset
      simulateFrames(SPEECH_FRAMES - 1, true);       // still short
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  // ─── Silence accumulator ─────────────────────────────────────────────────────

  describe('silence accumulator', () => {
    test('sends VAD_STOP after sustained silence in UNMUTED', () => {
      simulateFrames(SPEECH_FRAMES, true);           // → UNMUTED (optimistic)
      sendMessage.mockClear();
      simulateFrames(SILENCE_FRAMES, false);
      expect(sendMessage).toHaveBeenCalledWith({ type: 'VAD_STOP' });
    });

    test('does not fire from SOFT_MUTED (silence alone does nothing)', () => {
      simulateFrames(SILENCE_FRAMES, false);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('silenceMs resets on any speech frame', () => {
      simulateFrames(SPEECH_FRAMES, true);           // → UNMUTED
      sendMessage.mockClear();
      simulateFrames(SILENCE_FRAMES - 1, false);     // almost there
      simulateFrames(1, true);                       // reset silenceMs
      simulateFrames(SILENCE_FRAMES - 1, false);     // still short
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  // ─── State guards ────────────────────────────────────────────────────────────

  describe('state guards', () => {
    test('no VAD_START when HARD_MUTED', () => {
      setContentState('HARD_MUTED');
      simulateFrames(SPEECH_FRAMES * 2, true);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('no VAD_START when already UNMUTED', () => {
      simulateFrames(SPEECH_FRAMES, true);           // → UNMUTED (optimistic)
      sendMessage.mockClear();
      simulateFrames(SPEECH_FRAMES, true);
      expect(sendMessage).not.toHaveBeenCalledWith({ type: 'VAD_START' });
    });

    test('no VAD_STOP when SOFT_MUTED', () => {
      simulateFrames(SILENCE_FRAMES, false);
      expect(sendMessage).not.toHaveBeenCalledWith({ type: 'VAD_STOP' });
    });

    test('VAD loop resumes after SET_STATE restores SOFT_MUTED from HARD_MUTED', () => {
      setContentState('HARD_MUTED');
      simulateFrames(SPEECH_FRAMES, true);           // ignored
      expect(sendMessage).not.toHaveBeenCalled();

      setContentState('SOFT_MUTED');
      simulateFrames(SPEECH_FRAMES, true);           // now fires
      expect(sendMessage).toHaveBeenCalledWith({ type: 'VAD_START' });
    });
  });

  // ─── Optimistic state updates ─────────────────────────────────────────────────

  describe('optimistic state updates (no duplicate messages)', () => {
    test('VAD_START sent exactly once across many speech frames', () => {
      simulateFrames(SPEECH_FRAMES * 3, true);
      const calls = sendMessage.mock.calls.filter(c => c[0].type === 'VAD_START');
      expect(calls).toHaveLength(1);
    });

    test('VAD_STOP sent exactly once across many silence frames', () => {
      simulateFrames(SPEECH_FRAMES, true);           // → UNMUTED
      sendMessage.mockClear();
      simulateFrames(SILENCE_FRAMES * 3, false);
      const calls = sendMessage.mock.calls.filter(c => c[0].type === 'VAD_STOP');
      expect(calls).toHaveLength(1);
    });

    test('counter resets after crossing threshold, preventing immediate re-trigger', () => {
      simulateFrames(SPEECH_FRAMES, true);           // fires, resets speechMs to 0
      sendMessage.mockClear();
      simulateFrames(SPEECH_FRAMES - 1, true);       // below threshold again
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  // ─── Threshold ───────────────────────────────────────────────────────────────

  describe('threshold', () => {
    test('__vadSetThreshold raises threshold so previous speech no longer triggers', () => {
      globalThis.__vadSetThreshold(0.2);             // above RMS_SPEECH (0.15)
      simulateFrames(SPEECH_FRAMES, true);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    test('__vadSetThreshold lowers threshold so quiet audio now triggers', () => {
      globalThis.__vadSetThreshold(0.0005);          // below RMS_SILENCE (0.001)
      simulateFrames(SPEECH_FRAMES, false);           // "silence" is now above threshold
      expect(sendMessage).toHaveBeenCalledWith({ type: 'VAD_START' });
    });
  });
});
