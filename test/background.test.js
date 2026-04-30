// Tests for background.js state machine
// Verifies state transitions, platform actions, and storage persistence

const flush = () => new Promise(r => setImmediate(r));

let chrome;
let onMessage;

function buildChrome() {
  return {
    runtime: {
      onMessage: { addListener: jest.fn(fn => { onMessage = fn; }) },
      sendMessage: jest.fn(() => Promise.resolve()),
    },
    storage: {
      local: {
        get:  jest.fn(),                          // don't restore state between tests
        set:  jest.fn(() => Promise.resolve()),
      },
    },
    tabs: {
      query: jest.fn(({ active } = {}) =>
        Promise.resolve(active ? [{ id: 42 }] : [])
      ),
      sendMessage: jest.fn(() => Promise.resolve()),
    },
    scripting: {
      executeScript: jest.fn(() => Promise.resolve()),
    },
  };
}

beforeEach(() => {
  jest.resetModules();
  chrome = buildChrome();
  global.chrome = chrome;
  require('../background.js');
});

async function dispatch(msg) {
  onMessage(msg);
  await flush();
}

// ─── VAD_START ────────────────────────────────────────────────────────────────

describe('VAD_START', () => {
  test('SOFT_MUTED → UNMUTED, stores state, calls unmutePlatform', async () => {
    await dispatch({ type: 'VAD_START' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ state: 'UNMUTED' });
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test('HARD_MUTED → ignored, no state change', async () => {
    await dispatch({ type: 'HARD_MUTE_TOGGLE' });          // → HARD_MUTED
    chrome.storage.local.set.mockClear();
    await dispatch({ type: 'VAD_START' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('UNMUTED → ignored (already unmuted)', async () => {
    await dispatch({ type: 'VAD_START' });                 // → UNMUTED
    chrome.storage.local.set.mockClear();
    await dispatch({ type: 'VAD_START' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ─── VAD_STOP ─────────────────────────────────────────────────────────────────

describe('VAD_STOP', () => {
  test('UNMUTED → SOFT_MUTED, stores state, calls mutePlatform', async () => {
    await dispatch({ type: 'VAD_START' });                 // → UNMUTED
    chrome.storage.local.set.mockClear();
    chrome.scripting.executeScript.mockClear();
    await dispatch({ type: 'VAD_STOP' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ state: 'SOFT_MUTED' });
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test('SOFT_MUTED → ignored', async () => {
    await dispatch({ type: 'VAD_STOP' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  test('HARD_MUTED → ignored', async () => {
    await dispatch({ type: 'HARD_MUTE_TOGGLE' });          // → HARD_MUTED
    chrome.storage.local.set.mockClear();
    await dispatch({ type: 'VAD_STOP' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

// ─── HARD_MUTE_TOGGLE ─────────────────────────────────────────────────────────

describe('HARD_MUTE_TOGGLE', () => {
  test('SOFT_MUTED → HARD_MUTED + mutePlatform', async () => {
    await dispatch({ type: 'HARD_MUTE_TOGGLE' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ state: 'HARD_MUTED' });
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  test('HARD_MUTED → SOFT_MUTED, no platform action (mic stays muted, VAD resumes)', async () => {
    await dispatch({ type: 'HARD_MUTE_TOGGLE' });          // → HARD_MUTED
    chrome.storage.local.set.mockClear();
    chrome.scripting.executeScript.mockClear();
    await dispatch({ type: 'HARD_MUTE_TOGGLE' });          // → SOFT_MUTED
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ state: 'SOFT_MUTED' });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  test('UNMUTED → HARD_MUTED + mutePlatform (kills live mic)', async () => {
    await dispatch({ type: 'VAD_START' });                 // → UNMUTED
    chrome.storage.local.set.mockClear();
    chrome.scripting.executeScript.mockClear();
    await dispatch({ type: 'HARD_MUTE_TOGGLE' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ state: 'HARD_MUTED' });
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });
});

// ─── SET_THRESHOLD ────────────────────────────────────────────────────────────

describe('SET_THRESHOLD', () => {
  test('stores threshold in storage', async () => {
    await dispatch({ type: 'SET_THRESHOLD', value: 0.03 });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ threshold: 0.03 });
  });

  test('broadcasts via executeScript to meeting tabs', async () => {
    chrome.tabs.query.mockImplementation(({ active } = {}) =>
      Promise.resolve(active ? [{ id: 42 }] : [{ id: 1 }, { id: 2 }])
    );
    await dispatch({ type: 'SET_THRESHOLD', value: 0.02 });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
  });
});

// ─── setState broadcasts ───────────────────────────────────────────────────────

describe('setState broadcasts', () => {
  test('sends SET_STATE to all meeting tabs on transition', async () => {
    chrome.tabs.query.mockImplementation(({ active, url } = {}) => {
      if (url) return Promise.resolve([{ id: 10 }, { id: 11 }]);
      return Promise.resolve(active ? [{ id: 42 }] : []);
    });
    await dispatch({ type: 'VAD_START' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: 'SET_STATE', state: 'UNMUTED' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(11, { type: 'SET_STATE', state: 'UNMUTED' });
  });
});
