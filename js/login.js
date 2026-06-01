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
  setStatus('connect-status', '', '');
  document.getElementById('connect-btn').disabled = false;
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

  const list = document.getElementById('invitations-list');
  list.style.display = list.childElementCount > 0 ? 'flex' : 'none';
}

// ── Invitation cards UI ───────────────────────────────────────────────────────

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
  acceptBtn.textContent = 'Accepter';

  const declineBtn = document.createElement('button');
  declineBtn.className = 'btn-decline';
  declineBtn.textContent = 'Refuser';

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
  list.style.display = 'flex';
}

function removeInviteCard(roomId) {
  const list = document.getElementById('invitations-list');
  const card = list.querySelector(`[data-room-id="${roomId}"]`);
  if (card) card.remove();
  if (list.childElementCount === 0) list.style.display = 'none';
}

function clearInviteCards() {
  const list = document.getElementById('invitations-list');
  list.innerHTML = '';
  list.style.display = 'none';
}
