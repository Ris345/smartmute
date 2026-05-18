const STATE = { DISABLED: 'DISABLED', SOFT_MUTED: 'SOFT_MUTED', UNMUTED: 'UNMUTED' };

let currentState = STATE.SOFT_MUTED;

chrome.storage.local.get('state', ({ state }) => {
  if (state) currentState = state;
});

async function setState(newState) {
  currentState = newState;
  await chrome.storage.local.set({ state: newState });
  chrome.runtime.sendMessage({ type: 'SET_STATE', state: newState }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message) => {
  (async () => {
    switch (message.type) {
      case 'VAD_START':
        if (currentState === STATE.SOFT_MUTED) await setState(STATE.UNMUTED);
        break;

      case 'VAD_STOP':
        if (currentState === STATE.UNMUTED) await setState(STATE.SOFT_MUTED);
        break;

      case 'AUTO_TOGGLE':
        await setState(currentState === STATE.DISABLED ? STATE.SOFT_MUTED : STATE.DISABLED);
        break;
    }
  })();
});
