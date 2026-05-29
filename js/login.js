const ADJECTIVES = ['Blue', 'Red', 'Dark', 'Swift', 'Calm', 'Wild', 'Frost', 'Storm', 'Quiet', 'Bold'];
const NOUNS      = ['Wolf', 'Fox', 'Eagle', 'Tiger', 'Bear', 'Hawk', 'Lion', 'Shark', 'Raven', 'Lynx'];

let checkTimer = null;

// ── Screen: Login ─────────────────────────────────────────────────────────────

document.getElementById('generate-btn').addEventListener('click', () => {
  const adj      = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun     = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num      = Math.floor(Math.random() * 90) + 10;
  const username = `${adj}${noun}${num}`.toLowerCase();
  document.getElementById('username-input').value = username;
  triggerCheck(username);
});

document.getElementById('username-input').addEventListener('input', (e) => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toLowerCase();
  e.target.setSelectionRange(pos, pos);

  document.getElementById('next-btn').disabled = true;
  clearTimeout(checkTimer);
  const val = e.target.value.trim();
  if (val.length < 3) {
    setStatus('username-status', val.length > 0 ? 'Minimum 3 caractères' : '', val.length > 0 ? 'error' : '');
    return;
  }
  checkTimer = setTimeout(() => triggerCheck(val), 400);
});

document.getElementById('username-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('next-btn').click();
});

document.getElementById('next-btn').addEventListener('click', async () => {
  const username = document.getElementById('username-input').value.trim();
  if (!username) return;
  document.getElementById('next-btn').disabled = true;
  try {
    await registerUsername(username);
    document.getElementById('my-username-display').textContent = username;
    showScreen('connect');
  } catch (err) {
    setStatus('username-status', err.message, 'error');
    document.getElementById('next-btn').disabled = false;
  }
});

async function triggerCheck(val) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(val)) {
    setStatus('username-status', 'Lettres, chiffres et _ uniquement', 'error');
    document.getElementById('next-btn').disabled = true;
    return;
  }
  setStatus('username-status', '…', '');
  const available = await checkUsernameAvailable(val);
  if (document.getElementById('username-input').value.trim() !== val) return; // stale
  if (available) {
    setStatus('username-status', '✓ Disponible', 'ok');
    document.getElementById('next-btn').disabled = false;
  } else {
    setStatus('username-status', '✗ Déjà utilisé', 'error');
    document.getElementById('next-btn').disabled = true;
  }
}

// ── Screen: Connect ───────────────────────────────────────────────────────────

document.getElementById('back-btn').addEventListener('click', () => showScreen('login'));

document.getElementById('copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('my-username-display').textContent).then(() => {
    document.getElementById('copy-btn').textContent = '✓';
    setTimeout(() => (document.getElementById('copy-btn').textContent = '⎘'), 1500);
  });
});

document.getElementById('partner-input').addEventListener('input', (e) => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toLowerCase();
  e.target.setSelectionRange(pos, pos);
});

document.getElementById('partner-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('connect-btn').click();
});

document.getElementById('connect-btn').addEventListener('click', async () => {
  const partner = document.getElementById('partner-input').value.trim();
  if (!partner) return;
  if (partner === state.username) {
    return setStatus('connect-status', 'Vous ne pouvez pas vous connecter à vous-même', 'error');
  }
  document.getElementById('connect-btn').disabled = true;
  setStatus('connect-status', `En attente de ${partner}…`, 'waiting');
  try {
    await requestConnection(partner);
  } catch (err) {
    setStatus('connect-status', err.message, 'error');
    document.getElementById('connect-btn').disabled = false;
  }
});

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetLoginScreens() {
  document.getElementById('username-input').value = '';
  setStatus('username-status', '', '');
  document.getElementById('next-btn').disabled = true;
  document.getElementById('partner-input').value = '';
  setStatus('connect-status', '', '');
  document.getElementById('connect-btn').disabled = false;
}
