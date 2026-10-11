const btnAuto = document.getElementById('btn-auto');
const micLive = document.getElementById('mic-live');
const micLabel = document.getElementById('mic-label');

function render(state) {
  const isActive = state !== 'DISABLED';
  const isLive   = state === 'UNMUTED';

  btnAuto.classList.toggle('active', isActive);
  btnAuto.textContent = isActive ? 'AUTO MUTE ON' : 'AUTO MUTE OFF';

  micLive.classList.toggle('on', isLive);
  micLabel.textContent = isLive ? 'MIC LIVE' : isActive ? 'MIC STANDBY' : 'AUTO OFF';
}

chrome.storage.local.get('state', ({ state }) => {
  render(state ?? 'SOFT_MUTED');
});

btnAuto.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const isRunning = await chrome.tabs.sendMessage(tab.id, { type: 'PING' })
    .then(() => true)
    .catch(() => false);

  if (!isRunning) {
    // Only inject when the user is turning auto mute ON (DISABLED → SOFT_MUTED)
    const { state } = await chrome.storage.local.get('state');
    if (state === 'DISABLED') {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch (e) {
        console.warn('[popup] inject failed:', e.message);
      }
    }
  }

  chrome.runtime.sendMessage({ type: 'AUTO_TOGGLE' });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SET_STATE') render(message.state);
});
