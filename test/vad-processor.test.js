// Tests for audio-processor.js — pure RMS math + threshold logic

let VADProcessor;
let registeredName;

beforeAll(() => {
  global.AudioWorkletProcessor = class {
    constructor() {
      this.port = { onmessage: null, postMessage: jest.fn() };
    }
  };
  global.registerProcessor = jest.fn((name, cls) => {
    registeredName = name;
    VADProcessor = cls;
  });
  require('../audio-processor.js');
});

beforeEach(() => jest.clearAllMocks());

function makeProcessor() {
  return new VADProcessor();
}

describe('registration', () => {
  test('registers as vad-processor', () => {
    expect(registeredName).toBe('vad-processor');
    expect(typeof VADProcessor).toBe('function');
  });
});

describe('process() — RMS calculation', () => {
  test('uniform samples: RMS equals the sample value', () => {
    const p = makeProcessor();
    const ch = new Float32Array(128).fill(0.5);
    p.process([[ch]]);
    expect(p.port.postMessage.mock.calls[0][0].rms).toBeCloseTo(0.5, 5);
  });

  test('alternating ±0.5: RMS still 0.5 (squares cancel sign)', () => {
    const p = makeProcessor();
    const ch = new Float32Array(4);
    ch[0] = 0.5; ch[1] = -0.5; ch[2] = 0.5; ch[3] = -0.5;
    p.process([[ch]]);
    expect(p.port.postMessage.mock.calls[0][0].rms).toBeCloseTo(0.5, 5);
  });

  test('all-zero samples: RMS is 0', () => {
    const p = makeProcessor();
    p.process([[new Float32Array(128)]]);
    expect(p.port.postMessage.mock.calls[0][0].rms).toBe(0);
  });

  test('posts one message per process() call', () => {
    const p = makeProcessor();
    p.process([[new Float32Array(128).fill(0.1)]]);
    p.process([[new Float32Array(128).fill(0.1)]]);
    expect(p.port.postMessage).toHaveBeenCalledTimes(2);
  });
});

describe('process() — isSpeech threshold', () => {
  test('isSpeech true when RMS exceeds default threshold (0.015)', () => {
    const p = makeProcessor();
    p.process([[new Float32Array(128).fill(0.1)]]);
    expect(p.port.postMessage.mock.calls[0][0].isSpeech).toBe(true);
  });

  test('isSpeech false when RMS is below default threshold', () => {
    const p = makeProcessor();
    p.process([[new Float32Array(128).fill(0.001)]]);
    expect(p.port.postMessage.mock.calls[0][0].isSpeech).toBe(false);
  });

  test('isSpeech false when RMS exactly equals threshold', () => {
    const p = makeProcessor();
    p.process([[new Float32Array(128).fill(0.015)]]);
    // rms > threshold, not >=, so exactly equal is false
    expect(p.port.postMessage.mock.calls[0][0].isSpeech).toBe(false);
  });
});

describe('SET_THRESHOLD port message', () => {
  test('updates threshold; previously-passing signal now fails', () => {
    const p = makeProcessor();
    // 0.03 > 0.015 (default) → speech
    p.process([[new Float32Array(128).fill(0.03)]]);
    expect(p.port.postMessage.mock.calls[0][0].isSpeech).toBe(true);

    p.port.postMessage.mockClear();
    p.port.onmessage({ data: { type: 'SET_THRESHOLD', value: 0.05 } });

    // 0.03 < 0.05 (new) → not speech
    p.process([[new Float32Array(128).fill(0.03)]]);
    expect(p.port.postMessage.mock.calls[0][0].isSpeech).toBe(false);
  });

  test('ignores unknown message types', () => {
    const p = makeProcessor();
    p.port.onmessage({ data: { type: 'UNKNOWN', value: 999 } });
    p.process([[new Float32Array(128).fill(0.1)]]);
    expect(p.port.postMessage.mock.calls[0][0].isSpeech).toBe(true);
  });
});

describe('process() — guard clauses', () => {
  test('returns true (keep alive) on normal input', () => {
    const p = makeProcessor();
    expect(p.process([[new Float32Array(4).fill(0.1)]])).toBe(true);
  });

  test('returns true and skips posting on empty channel array', () => {
    const p = makeProcessor();
    expect(p.process([[]])).toBe(true);
    expect(p.port.postMessage).not.toHaveBeenCalled();
  });

  test('returns true and skips posting when inputs is empty', () => {
    const p = makeProcessor();
    expect(p.process([[]])).toBe(true);
    expect(p.port.postMessage).not.toHaveBeenCalled();
  });
});
