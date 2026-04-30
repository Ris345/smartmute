const STATE = { HARD_MUTED: 'HARD_MUTED', SOFT_MUTED: 'SOFT_MUTED', UNMUTED: 'UNMUTED' };

let currentState = STATE.SOFT_MUTED;

chrome.storage.local.get('state', ({ state }) => {
  if (state) currentState = state;
});

async function setState(newState) {
  currentState = newState;
  await chrome.storage.local.set({ state: newState });
  // Notify popup for live UI updates
  chrome.runtime.sendMessage({ type: 'SET_STATE', state: newState }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message) => {
  (async () => {
    switch (message.type) {
      case 'VAD_START':
        if (currentState === STATE.SOFT_MUTED) {
          await setState(STATE.UNMUTED);
        }
        break;

      case 'VAD_STOP':
        if (currentState === STATE.UNMUTED) {
          await setState(STATE.SOFT_MUTED);
        }
        break;

      case 'HARD_MUTE_TOGGLE':
        if (currentState === STATE.HARD_MUTED) {
          await setState(STATE.SOFT_MUTED);
        } else {
          await setState(STATE.HARD_MUTED);
        }
        break;
    }
  })();
});
