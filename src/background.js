const STATE = {
  DISABLED:   'DISABLED',
  SOFT_MUTED: 'SOFT_MUTED',
  UNMUTED:    'UNMUTED',
  HARD_MUTED: 'HARD_MUTED',
};

const MEETING_URLS = [
  'https://meet.google.com/*',
  'https://teams.microsoft.com/*',
  'https://zoom.us/*',
  'https://app.webex.com/*',
  'https://meet.jit.si/*',
  'https://whereby.com/*',
  'https://discord.com/*',
  'https://web.skype.com/*',
];

let currentState = STATE.SOFT_MUTED;

chrome.storage.local.get('state', ({ state }) => {
  if (state) currentState = state;
});

async function execInActiveTab(func) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  return chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
}

function mutePlatform() {
  return execInActiveTab(() => {
    const host = location.hostname;
    if (host.includes('meet.google.com')) {
      document.querySelector('button[aria-label="Turn off microphone"]')?.click();
    } else if (host.includes('zoom.us')) {
      document.querySelector('.join-audio-container__btn')?.click();
    } else {
      const sels = [
        'button[aria-label*="microphone" i]:not([aria-label*="camera" i])',
        'button[aria-label*="mute" i]:not([aria-label*="camera" i])',
      ];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) { el.click(); return; }
      }
      for (const t of ['keydown', 'keyup']) {
        document.dispatchEvent(new KeyboardEvent(t, {
          key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
        }));
      }
    }
  });
}

function unmutePlatform() {
  return execInActiveTab(() => {
    const host = location.hostname;
    if (host.includes('meet.google.com')) {
      document.querySelector('button[aria-label="Turn on microphone"]')?.click();
    } else if (host.includes('zoom.us')) {
      document.querySelector('.join-audio-container__btn')?.click();
    } else {
      const sels = [
        'button[aria-label*="microphone" i]:not([aria-label*="camera" i])',
        'button[aria-label*="mute" i]:not([aria-label*="camera" i])',
      ];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) { el.click(); return; }
      }
      for (const t of ['keydown', 'keyup']) {
        document.dispatchEvent(new KeyboardEvent(t, {
          key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
        }));
      }
    }
  });
}

async function setState(newState) {
  currentState = newState;
  await chrome.storage.local.set({ state: newState });
  chrome.runtime.sendMessage({ type: 'SET_STATE', state: newState }).catch(() => {});
  const tabs = await chrome.tabs.query({ url: MEETING_URLS });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'SET_STATE', state: newState }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message) => {
  (async () => {
    switch (message.type) {
      case 'VAD_START':
        if (currentState === STATE.SOFT_MUTED) {
          await setState(STATE.UNMUTED);
          await unmutePlatform();
        }
        break;

      case 'VAD_STOP':
        if (currentState === STATE.UNMUTED) {
          await setState(STATE.SOFT_MUTED);
          await mutePlatform();
        }
        break;

      case 'HARD_MUTE_TOGGLE':
        if (currentState === STATE.HARD_MUTED) {
          await setState(STATE.SOFT_MUTED);
        } else {
          await setState(STATE.HARD_MUTED);
          await mutePlatform();
        }
        break;

      case 'AUTO_TOGGLE':
        await setState(currentState === STATE.DISABLED ? STATE.SOFT_MUTED : STATE.DISABLED);
        break;

      case 'SET_THRESHOLD': {
        await chrome.storage.local.set({ threshold: message.value });
        const tabs = await chrome.tabs.query({ url: MEETING_URLS });
        for (const tab of tabs) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (v) => { if (typeof window.__vadSetThreshold === 'function') window.__vadSetThreshold(v); },
            args: [message.value],
          }).catch(() => {});
        }
        break;
      }
    }
  })();
});
