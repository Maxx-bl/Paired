const ADJECTIVES = [
  'Blue', 'Red', 'Dark', 'Swift', 'Calm', 'Wild', 'Frost', 'Storm', 'Quiet', 'Bold',
  'Ash', 'Iron', 'Neon', 'Void', 'Dawn', 'Dusk', 'Grim', 'Keen', 'Lone', 'Bare',
  'Jade', 'Onyx', 'Crisp', 'Blaze', 'Shade', 'Sleek', 'Stark', 'Thorn', 'Brisk', 'Gust',
  'Cold', 'Sage', 'Rash', 'Ebon', 'Glow', 'Hazy', 'Icy', 'Murk', 'Pale', 'Raw',
  'Sly', 'Tame', 'Wry', 'Dull', 'Fleet', 'Gruff', 'Hardy', 'Legendary'
];

const NOUNS = [
  'Wolf', 'Fox', 'Eagle', 'Tiger', 'Bear', 'Hawk', 'Lion', 'Shark', 'Raven', 'Lynx',
  'Crow', 'Viper', 'Boar', 'Drake', 'Elk', 'Crane', 'Bison', 'Adder', 'Kite', 'Pike',
  'Puma', 'Ibis', 'Stoat', 'Moose', 'Gecko', 'Finch', 'Heron', 'Mink',
  'Orca', 'Newt', 'Asp', 'Tapir', 'Mole', 'Vole', 'Toad',
  'Panda', 'Manta', 'Gator', 'Squid', 'Zebra', 'Bream', 'Koi'
];

let checkTimer = null;

// ── Theme toggle ─────────────────────────────────────────────────────────────

const MOON_SVG = '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const SUN_SVG  = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

function updateThemeIcons(isDark) {
  document.querySelectorAll('.btn-theme').forEach(btn => { btn.innerHTML = isDark ? SUN_SVG : MOON_SVG; });
}

updateThemeIcons(document.documentElement.classList.contains('dark'));

document.querySelectorAll('.btn-theme').forEach(btn => {
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcons(isDark);
  });
});

// ── Info modal ────────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-info').forEach(btn => {
  btn.addEventListener('click', () => openModal('info-modal'));
});

document.getElementById('info-modal-close').addEventListener('click', () => closeModal('info-modal'));
document.getElementById('info-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('info-modal');
});

// ── PWA install ───────────────────────────────────────────────────────────────

let deferredInstallPrompt = null;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.style.display = 'block';
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.style.display = 'none';
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installBtn.style.display = 'none';
});

// ── Screen: Login ─────────────────────────────────────────────────────────────

document.getElementById('generate-btn').addEventListener('click', () => {
  const noun     = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num      = Math.floor(Math.random() * 90) + 10;
  const username = `${noun}${num}`.toLowerCase();
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
    localStorage.setItem('lastUsername', username);
    document.getElementById('my-username-display').textContent = username;
    showScreen('connect');
  } catch (err) {
    setStatus('username-status', err.message, 'error');
    document.getElementById('next-btn').disabled = false;
  }
});

// Preload last used pseudo so returning users can just hit "Confirmer"
const lastUsername = localStorage.getItem('lastUsername');
if (lastUsername) {
  document.getElementById('username-input').value = lastUsername;
  triggerCheck(lastUsername);
}

async function triggerCheck(val) {
  if (!/^[a-z0-9]{3,20}$/.test(val)) {
    setStatus('username-status', 'Lettres et chiffres uniquement', 'error');
    document.getElementById('next-btn').disabled = true;
    return;
  }
  setStatus('username-status', '…', '');
  const available = await checkUsernameAvailable(val);
  if (document.getElementById('username-input').value.trim() !== val) return; // stale
  if (available) {
    setStatus('username-status', 'Disponible', 'ok');
    document.getElementById('next-btn').disabled = false;
  } else {
    setStatus('username-status', 'Déjà utilisé', 'error');
    document.getElementById('next-btn').disabled = true;
  }
}

// ── Screen: Connect ───────────────────────────────────────────────────────────

document.getElementById('duration-toggle').addEventListener('click', () => {
  document.querySelector('.connect-inputs').classList.add('dur-open');
  document.getElementById('duration-input').focus();
});

document.getElementById('duration-unit-label').addEventListener('click', () => {
  document.querySelector('.connect-inputs').classList.remove('dur-open');
});

// Back button: properly cancels any pending state and frees the username
document.getElementById('back-btn').addEventListener('click', async () => {
  const btn = document.getElementById('back-btn');
  btn.disabled = true;
  await goBack(); // defined in app.js
  btn.disabled = false;
});

document.getElementById('copy-btn').addEventListener('click', () => {
  const text = document.getElementById('my-username-display').textContent;
  const btn  = document.getElementById('copy-btn');
  const confirm = () => {
    btn.textContent = 'Copié';
    setTimeout(() => (btn.textContent = 'Copier'), 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(confirm).catch(confirm);
  } else {
    // Fallback pour navigateurs sans clipboard API
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity  = '0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(el);
    confirm();
  }
});

document.getElementById('partner-input').addEventListener('input', (e) => {
  const pos = e.target.selectionStart;
  e.target.value = e.target.value.toLowerCase();
  e.target.setSelectionRange(pos, pos);
  document.getElementById('connect-btn').disabled = e.target.value.trim().length === 0;
});

document.getElementById('partner-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('connect-btn').click();
});

document.getElementById('duration-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { document.getElementById('connect-btn').click(); return; }
  // Allow: backspace, delete, tab, arrows, home, end
  if (['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
  // Block anything that's not a digit
  if (!/^\d$/.test(e.key)) e.preventDefault();
});

document.getElementById('duration-input').addEventListener('input', (e) => {
  let val = parseInt(e.target.value, 10);
  if (isNaN(val) || val < 1) {
    e.target.value = '';
  } else if (val > 60) {
    e.target.value = '60';
  }
});

document.getElementById('connect-btn').addEventListener('click', async () => {
  const partner = document.getElementById('partner-input').value.trim();
  if (!partner) return;
  if (partner === state.username) {
    return setStatus('connect-status', 'Vous ne pouvez pas vous connecter à vous-même', 'error');
  }
  const durationVal = parseInt(document.getElementById('duration-input').value, 10);
  const duration = (!isNaN(durationVal) && durationVal >= 1 && durationVal <= 60) ? durationVal : 60;
  document.getElementById('connect-btn').disabled = true;
  setStatus('connect-status', `En attente de ${partner}…`, 'waiting');
  try {
    await requestConnection(partner, duration);
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
  document.getElementById('duration-input').value = '';
  document.querySelector('.connect-inputs')?.classList.remove('dur-open');
  setStatus('connect-status', '', '');
  document.getElementById('connect-btn').disabled = true;
  clearInviteCards();
}

// Re-query invites when the tab becomes visible again (mobile backgrounding safety net)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.username && !state.roomId) {
    db.ref(`invites/${state.username}`).once('value').then(syncInviteCards);
  }
});

// ── Invitation sync (called by Firebase value listener) ───────────────────────

function syncInviteCards(snap) {
  if (state.roomId || state.leaving) return;

  const active = new Set();

  if (snap.exists()) {
    snap.forEach(child => {
      const { from, roomId, duration: theirDuration } = child.val();
      if (!from || !roomId) return;
      active.add(roomId);

      // Mutual invite: both users clicked "Se connecter" on each other → auto-accept with max duration
      if (state.pendingRoomId && state.pendingPartner === from && !state.joiningRoom) {
        if (state.username < from) return; // we're initiator, skip
        state.joiningRoom = true;
        const ownDuration = state.pendingDuration || 60;
        const inviteDuration = theirDuration || 60;
        cancelPendingConnection()
          .then(() => acceptInvitation(from, roomId, inviteDuration, ownDuration))
          .catch(() => { state.joiningRoom = false; });
        return;
      }

      showInviteCard(from, roomId, theirDuration || 60);
    });
  }

  // Remove cards whose invite was withdrawn from Firebase
  document.querySelectorAll('#invitations-list .invite-card').forEach(card => {
    if (!active.has(card.dataset.roomId)) card.remove();
  });

  updateInvitationsUI();
}

// ── Invitation cards UI ───────────────────────────────────────────────────────

function updateInvitationsUI() {
  const list   = document.getElementById('invitations-list');
  const header = document.getElementById('invitations-header');
  const waiting = document.getElementById('waiting-hint');
  const count  = list.childElementCount;

  if (count > 0) {
    list.style.display = 'flex';
    header.style.display = '';
    header.textContent = count === 1 ? 'Invitation reçue : 1' : `Invitations reçues : ${count}`;
    if (waiting) waiting.style.display = 'none';
  } else {
    list.style.display = 'none';
    header.style.display = 'none';
    if (waiting) waiting.style.display = '';
  }
}

function showInviteCard(from, roomId, theirDuration = 60) {
  const list = document.getElementById('invitations-list');

  // Avoid duplicates
  if (list.querySelector(`[data-room-id="${roomId}"]`)) return;

  const card = document.createElement('div');
  card.className = 'invite-card';
  card.dataset.roomId = roomId;

  const fromEl = document.createElement('span');
  fromEl.className = 'invite-from';
  fromEl.textContent = from;

  const actions = document.createElement('div');
  actions.className = 'invite-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'btn-accept';
  acceptBtn.setAttribute('aria-label', 'Accepter');
  acceptBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  const declineBtn = document.createElement('button');
  declineBtn.className = 'btn-decline';
  declineBtn.setAttribute('aria-label', 'Refuser');
  declineBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    declineBtn.disabled = true;
    await acceptInvitation(from, roomId, theirDuration);
  });

  declineBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    declineBtn.disabled = true;
    await rejectInvitation(from, roomId);
  });

  actions.appendChild(acceptBtn);
  actions.appendChild(declineBtn);
  card.appendChild(fromEl);
  card.appendChild(actions);
  list.appendChild(card);
  updateInvitationsUI();
}

function removeInviteCard(roomId) {
  const list = document.getElementById('invitations-list');
  const card = list.querySelector(`[data-room-id="${roomId}"]`);
  if (card) card.remove();
  updateInvitationsUI();
}

function clearInviteCards() {
  const list = document.getElementById('invitations-list');
  list.innerHTML = '';
  updateInvitationsUI();
}
