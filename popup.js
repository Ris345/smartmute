const btnSoft = document.getElementById('btn-soft');
const btnHard = document.getElementById('btn-hard');
const micLive = document.getElementById('mic-live');
const micLabel = document.getElementById('mic-label');

let currentPopupState = 'SOFT_MUTED';

function render(state) {
  currentPopupState = state;
  const isHard = state === 'HARD_MUTED';
  const isLive = state === 'UNMUTED';

  btnSoft.classList.toggle('active', !isHard);
  btnHard.classList.toggle('active', isHard);
  btnHard.textContent = isHard ? 'UNMUTE' : 'HARD MUTE';

  micLive.classList.toggle('on', isLive);
  micLabel.textContent = isLive ? 'MIC LIVE' : 'MIC STANDBY';
}

chrome.storage.local.get('state', ({ state }) => {
  render(state ?? 'SOFT_MUTED');
});

// Only fires when soft mute is NOT already active (i.e. when exiting hard mute)
btnSoft.addEventListener('click', () => {
  if (currentPopupState !== 'HARD_MUTED') return;
  chrome.runtime.sendMessage({ type: 'HARD_MUTE_TOGGLE' });
});

// Hard mute button always toggles (enter hard mute OR exit via UNMUTE)
btnHard.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'HARD_MUTE_TOGGLE' });
});


chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SET_STATE') {
    render(message.state);
  }
});
