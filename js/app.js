// ── UUID (crypto.randomUUID absent sur certains navigateurs mobiles) ──────────
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  username:           null,
  partnerUsername:    null,
  roomId:             null,
  role:               null,
  cryptoReady:        false,
  timerInterval:      null,
  timerEndTime:       null,
  invitePoller:       null,  // fallback polling when WebSocket listener is unreliable (mobile)
  pendingRoomId:      null,
  pendingPartner:     null,
  pendingDuration:    60,    // minutes, stored when sending an invite
  pendingKeyRef:      null,  // Firebase ref listened for partner's key acceptance
  pendingDeclinedRef: null,  // Firebase ref listened for partner's decline
  leaving:            false, // true during endSession (blocks ghost notifications)
  partnerLeft:        false,
  joiningRoom:        false, // lock against concurrent room joins
};

// ── Instances ─────────────────────────────────────────────────────────────────
const cryptoMgr = new CryptoManager();
const webrtcMgr = new WebRTCManager();

webrtcMgr.onChannelOpen = () => {
  document.getElementById('message-input').disabled = false;
  document.getElementById('send-btn').disabled      = false;

  const btn = document.getElementById('file-btn');
  if (!btn) return;
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  btn.title = isTouch
    ? 'Connexion directe active — appuyer pour joindre un fichier'
    : 'Connexion directe active — glisser un fichier ici';
  btn.classList.add('p2p-ready');
};

webrtcMgr.onMessageReceived = async ({ ciphertext, timestamp }) => {
  if (!state.cryptoReady) return;
  try {
    const text = await cryptoMgr.decrypt(ciphertext);
    appendMessage({ text, sender: state.partnerUsername, timestamp, isOwn: false });
  } catch { /* message indéchiffrable ignoré */ }
};
webrtcMgr.onConnectionType  = (type) => {
  const badge = document.getElementById('conn-type-badge');
  if (!badge) return;
  badge.textContent = type;
  badge.className   = `conn-badge ${type.toLowerCase()}`;
  badge.style.display = '';
};
const CONN_INFO = {
  P2P: {
    title: 'Connexion P2P directe (Peer-to-peer)',
    text:  'Vos données transitent directement entre vous et votre interlocuteur, sans passer par aucun serveur intermédiaire. Les messages sont chiffrés de bout en bout (ECDH + AES-GCM). Les fichiers sont protégés par le chiffrement WebRTC (DTLS), intégré au protocole.',
  },
  TURN: {
    title: 'Connexion via relais (TURN)',
    text:  'La connexion directe P2P n\'a pas pu s\'établir, probablement à cause d\'un pare-feu ou d\'une configuration réseau restrictive. Vos données transitent par un serveur relais : les messages restent chiffrés de bout en bout, et les fichiers sont protégés par le chiffrement DTLS de WebRTC.',
  },
};

document.getElementById('conn-type-badge').addEventListener('click', () => {
  const badge = document.getElementById('conn-type-badge');
  const type  = badge.textContent.trim();
  const info  = CONN_INFO[type];
  if (!info) return;
  document.getElementById('conn-info-title').textContent = info.title;
  document.getElementById('conn-info-text').textContent  = info.text;
  openModal('conn-info-modal');
});

document.getElementById('conn-info-close').addEventListener('click', () => closeModal('conn-info-modal'));
document.getElementById('conn-info-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('conn-info-modal');
});

webrtcMgr.onFileReceived    = ({ blob, name, size }) => { hideProgress(); appendFileMessage({ blob, name, size, isOwn: false }); };
webrtcMgr.onReceiveProgress = (pct, name) => showProgress(name, pct, false);
webrtcMgr.onSendProgress    = (pct, name) => { showProgress(name, pct, true); if (pct >= 1) setTimeout(hideProgress, 800); };

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('closing');
  el.style.display = 'flex';
}
function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.add('closing');
  setTimeout(() => {
    if (el.classList.contains('closing')) {
      el.classList.remove('closing');
      el.style.display = 'none';
    }
  }, 180);
}

// ── Screen ────────────────────────────────────────────────────────────────────
const SCREEN_ORDER = { login: 0, connect: 1, chat: 2 };
let _savedBrandRect = null;

function showScreen(name) {
  const current     = document.querySelector('.screen.active');
  const currentName = current?.id.replace('screen-', '') ?? 'login';
  const isForward   = (SCREEN_ORDER[name] ?? 0) >= (SCREEN_ORDER[currentName] ?? 0);

  const apply = () => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${name}`).classList.add('active');
  };

  if (!document.startViewTransition) { apply(); return; }

  document.documentElement.dataset.vtDir = isForward ? 'forward' : 'back';

  const brandEl = document.querySelector('#screen-login .brand-name');

  const pinBrand = (rect) => {
    const el = document.createElement('style');
    el.id = '__vt_brand_pin';
    el.textContent = `::view-transition-group(brand-name){animation:none!important;width:${rect.width}px!important;height:${rect.height}px!important;transform:translateX(${rect.left}px) translateY(${rect.top}px)!important;}`;
    document.head.appendChild(el);
  };
  const unpinBrand = () => document.getElementById('__vt_brand_pin')?.remove();

  if (isForward && currentName === 'login' && brandEl) {
    _savedBrandRect = brandEl.getBoundingClientRect();
    pinBrand(_savedBrandRect);
    document.startViewTransition(apply).finished.then(unpinBrand);

  } else if (!isForward && name === 'login' && brandEl && _savedBrandRect) {
    pinBrand(_savedBrandRect);
    document.startViewTransition(apply).finished.then(unpinBrand);

  } else {
    document.startViewTransition(apply);
  }
}

// ── Username check ────────────────────────────────────────────────────────────
async function checkUsernameAvailable(username) {
  const snap = await db.ref(`presence/${username}`).once('value');
  return !snap.exists();
}

// ── Register username ─────────────────────────────────────────────────────────
async function registerUsername(username) {
  const available = await checkUsernameAvailable(username);
  if (!available) throw new Error('Pseudo déjà utilisé');

  const presRef = db.ref(`presence/${username}`);
  await presRef.onDisconnect().remove();
  await presRef.set({ ts: firebase.database.ServerValue.TIMESTAMP });

  state.username = username;

  // value fires on connect, reconnect, and any change — more reliable than child_added on mobile
  // No onDisconnect on the invite node: mobile browsers temporarily disconnect when backgrounded,
  // which would prematurely wipe incoming invites before the user can see them.
  const invRef = db.ref(`invites/${username}`);
  invRef.on('value', syncInviteCards);

  // Polling fallback: on some mobile browsers (Android Firefox) the persistent WebSocket
  // listener is not reliably triggered. once() is a plain read and always works.
  state.invitePoller = setInterval(async () => {
    if (!state.username || state.roomId || state.leaving) return;
    const snap = await db.ref(`invites/${state.username}`).once('value');
    syncInviteCards(snap);
  }, 2000);
}

// ── Unregister user (frees the username, cleans Firebase presence) ─────────────
async function unregisterUser() {
  const { username } = state;
  if (!username) return;

  clearInterval(state.invitePoller);
  state.invitePoller = null;
  state.username = null;

  db.ref(`invites/${username}`).off();
  await db.ref(`invites/${username}`).remove(); // explicit cleanup — not via onDisconnect
  await db.ref(`presence/${username}`).onDisconnect().cancel();
  await db.ref(`presence/${username}`).remove();
}

// ── Cancel a pending connection request (waiting state) ───────────────────────
async function cancelPendingConnection() {
  const { pendingRoomId, pendingPartner, pendingKeyRef, pendingDeclinedRef } = state;

  pendingKeyRef?.off();
  pendingDeclinedRef?.off();
  state.pendingKeyRef      = null;
  state.pendingDeclinedRef = null;
  state.pendingRoomId      = null;
  state.pendingPartner     = null;
  state.pendingDuration    = 60;

  if (pendingRoomId) {
    await db.ref(`rooms/${pendingRoomId}`).onDisconnect().cancel();
    await db.ref(`rooms/${pendingRoomId}`).remove();
  }
  if (pendingPartner && pendingRoomId) {
    await db.ref(`invites/${pendingPartner}/${pendingRoomId}`).onDisconnect().cancel();
    await db.ref(`invites/${pendingPartner}/${pendingRoomId}`).remove();
  }
}

// ── Go back from connect screen (with or without a pending invite) ────────────
async function goBack() {
  if (state.leaving) return;
  state.leaving = true;

  await cancelPendingConnection();
  await unregisterUser();

  state.leaving = false;

  showScreen('login');
  resetLoginScreens();
}

// ── Request connection to partner ─────────────────────────────────────────────
async function requestConnection(partnerUsername, ownDuration = 60) {
  // If the partner already sent us an invite, accept it directly (they are the initiator)
  const existingSnap = await db.ref(`invites/${state.username}`).once('value');
  if (existingSnap.exists()) {
    let theirInvite = null;
    existingSnap.forEach(child => {
      if (child.val().from === partnerUsername) { theirInvite = child.val(); return true; }
    });
    if (theirInvite) {
      await acceptInvitation(partnerUsername, theirInvite.roomId, theirInvite.duration || 60);
      return;
    }
  }

  // Check partner is online before sending invite
  const presSnap = await db.ref(`presence/${partnerUsername}`).once('value');
  if (!presSnap.exists()) throw new Error('Utilisateur introuvable');

  const roomId = generateUUID();
  state.pendingRoomId    = roomId;
  state.pendingPartner   = partnerUsername;
  state.pendingDuration  = ownDuration;

  await db.ref(`rooms/${roomId}`).onDisconnect().remove();

  const myPublicKey = await cryptoMgr.generateKeyPair();
  await db.ref(`rooms/${roomId}/keys/${state.username}`).set(myPublicKey);

  const invRef = db.ref(`invites/${partnerUsername}/${roomId}`);
  await invRef.onDisconnect().remove();
  await invRef.set({ from: state.username, roomId, duration: ownDuration, ts: firebase.database.ServerValue.TIMESTAMP });

  // Listen for partner's key — their acceptance signal
  const partnerKeyRef = db.ref(`rooms/${roomId}/keys/${partnerUsername}`);
  state.pendingKeyRef = partnerKeyRef;

  partnerKeyRef.on('value', async (snap) => {
    if (!snap.exists()) return;
    if (!state.pendingRoomId || state.joiningRoom || state.leaving) return;

    partnerKeyRef.off();
    state.pendingDeclinedRef?.off();
    state.pendingKeyRef      = null;
    state.pendingDeclinedRef = null;

    // Read the session duration resolved by the receiver (handles mutual-invite max)
    const durationSnap = await db.ref(`rooms/${roomId}/sessionDuration`).once('value');
    const sessionDuration = durationSnap.exists() ? durationSnap.val() : (state.pendingDuration || 60);

    state.joiningRoom = true;
    try {
      await cryptoMgr.deriveSharedKey(snap.val());
      state.cryptoReady = true;
      await enterRoom(roomId, partnerUsername, 'initiator', sessionDuration);
    } finally {
      state.joiningRoom = false;
    }
  });

  // Listen for partner declining the invite
  const declinedRef = db.ref(`rooms/${roomId}/declined`);
  state.pendingDeclinedRef = declinedRef;

  declinedRef.on('value', async (snap) => {
    if (!snap.exists()) return;
    if (!state.pendingRoomId || state.leaving) return;
    declinedRef.off();
    state.pendingDeclinedRef = null;
    await cancelPendingConnection();
    setStatus('connect-status', `${partnerUsername} a refusé la connexion`, 'error');
    document.getElementById('connect-btn').disabled = false;
  });
}

// ── Accept an invitation ──────────────────────────────────────────────────────
// theirDuration: session duration from the invite sender (minutes)
// ownPendingDuration: our own pending duration if this is a mutual invite (null otherwise)
async function acceptInvitation(from, roomId, theirDuration = 60, ownPendingDuration = null) {
  if (state.roomId || state.joiningRoom || state.leaving) return;

  clearInviteCards();

  // Cancel any unrelated outgoing pending invite
  if (state.pendingRoomId) await cancelPendingConnection();

  const sessionDuration = ownPendingDuration !== null
    ? Math.max(theirDuration, ownPendingDuration)
    : theirDuration;

  state.joiningRoom = true;
  try {
    const initiatorKeySnap = await db.ref(`rooms/${roomId}/keys/${from}`).once('value');
    if (!initiatorKeySnap.exists() || state.leaving) return;

    const myPublicKey = await cryptoMgr.generateKeyPair();
    await cryptoMgr.deriveSharedKey(initiatorKeySnap.val());
    state.cryptoReady = true;

    // Write resolved duration BEFORE writing our key so the initiator can read it reliably
    await db.ref(`rooms/${roomId}/sessionDuration`).set(sessionDuration);
    await db.ref(`rooms/${roomId}/keys/${state.username}`).set(myPublicKey);
    await db.ref(`invites/${state.username}`).remove();

    await enterRoom(roomId, from, 'receiver', sessionDuration);
  } finally {
    state.joiningRoom = false;
  }
}

// ── Decline an invitation ─────────────────────────────────────────────────────
async function rejectInvitation(from, roomId) {
  removeInviteCard(roomId);
  await db.ref(`rooms/${roomId}/declined`).set(true);
  await db.ref(`invites/${state.username}/${roomId}`).remove();
}

// ── Enter room ────────────────────────────────────────────────────────────────
async function enterRoom(roomId, partnerUsername, role, sessionDuration = 60) {
  clearInterval(state.invitePoller);
  state.invitePoller    = null;
  state.roomId          = roomId;
  state.partnerUsername = partnerUsername;
  state.role            = role;
  state.pendingRoomId   = null;
  state.pendingPartner  = null;
  state.pendingKeyRef   = null;
  state.partnerLeft     = false;

  await db.ref(`rooms/${roomId}`).onDisconnect().remove();

  if (role === 'initiator') {
    await db.ref(`rooms/${roomId}/meta`).set({
      user1: state.username,
      user2: partnerUsername,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
  }

  await webrtcMgr.loadIceServers();

  setupWebRTCSignaling(roomId, role);
  setupPartnerLeftListener(roomId);

  document.querySelector('.chat-avatar .presence-dot')?.classList.remove('offline');
  showScreen('chat');
  initChatScreen(partnerUsername);
  startTimer(sessionDuration * 60);
  document.getElementById('security-btn').style.display = '';

  if (role === 'initiator') await webrtcMgr.createOffer();
}

// ── WebRTC signaling via Firebase ─────────────────────────────────────────────
function setupWebRTCSignaling(roomId, role) {
  const myIcePath   = `rooms/${roomId}/webrtc/ice_${role}`;
  const peerRole    = role === 'initiator' ? 'receiver' : 'initiator';
  const peerIcePath = `rooms/${roomId}/webrtc/ice_${peerRole}`;

  webrtcMgr.sendOffer  = (sdp) => db.ref(`rooms/${roomId}/webrtc/offer`).set({ sdp: sdp.sdp, type: sdp.type });
  webrtcMgr.sendAnswer = (sdp) => db.ref(`rooms/${roomId}/webrtc/answer`).set({ sdp: sdp.sdp, type: sdp.type });
  webrtcMgr.sendIce    = (c)   => db.ref(myIcePath).push(c.toJSON ? c.toJSON() : c);

  db.ref(peerIcePath).on('child_added', (snap) => {
    webrtcMgr.addIceCandidate(new RTCIceCandidate(snap.val()));
  });

  if (role === 'receiver') {
    const offerRef = db.ref(`rooms/${roomId}/webrtc/offer`);
    offerRef.on('value', async (snap) => {
      if (!snap.exists()) return;
      offerRef.off();
      const { sdp, type } = snap.val();
      await webrtcMgr.handleOffer(new RTCSessionDescription({ sdp, type }));
    });
  } else {
    const answerRef = db.ref(`rooms/${roomId}/webrtc/answer`);
    answerRef.on('value', async (snap) => {
      if (!snap.exists()) return;
      answerRef.off();
      const { sdp, type } = snap.val();
      await webrtcMgr.handleAnswer(new RTCSessionDescription({ sdp, type }));
    });
  }
}

// ── Partner-left detection ────────────────────────────────────────────────────
function setupPartnerLeftListener(roomId) {
  let metaWasSet = false;
  db.ref(`rooms/${roomId}/meta`).on('value', (snap) => {
    if (snap.exists()) {
      metaWasSet = true;
    } else if (metaWasSet && state.roomId && !state.leaving) {
      state.partnerLeft = true;
      document.querySelector('.chat-avatar .presence-dot')?.classList.add('offline');
      appendSystemMessage(`${state.partnerUsername} a quitté la conversation.`);
      document.getElementById('message-input').disabled = true;
      document.getElementById('send-btn').disabled = true;
      document.getElementById('file-btn').disabled = true;
    }
  });
}

// ── Send encrypted message via P2P data channel ───────────────────────────────
async function sendEncryptedMessage(text) {
  if (!state.roomId || !state.cryptoReady) return;
  const ciphertext = await cryptoMgr.encrypt(text);
  webrtcMgr.sendMessage(ciphertext);
}

// ── End session (leave chat room) ─────────────────────────────────────────────
async function endSession() {
  if (state.leaving) return;
  state.leaving = true;
  stopTimer();
  webrtcMgr.destroy();

  const { roomId } = state;

  state.roomId             = null;
  state.partnerUsername    = null;
  state.role               = null;
  state.cryptoReady        = false;
  state.pendingRoomId      = null;
  state.pendingPartner     = null;
  state.pendingKeyRef      = null;
  state.pendingDeclinedRef = null;
  state.partnerLeft        = false;

  if (roomId) {
    await db.ref(`rooms/${roomId}`).onDisconnect().cancel();
    await db.ref(`rooms/${roomId}`).remove();
  }

  await unregisterUser();

  state.leaving = false;

  document.getElementById('security-btn').style.display   = 'none';
  document.getElementById('security-modal').style.display = 'none';

  showScreen('login');
  resetLoginScreens();
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  state.timerEndTime = Date.now() + seconds * 1000;
  const el = document.getElementById('timer');
  el.classList.remove('timer-warning');
  const update = () => {
    const remaining = Math.max(0, Math.ceil((state.timerEndTime - Date.now()) / 1000));
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
    if (remaining <= 60) el.classList.add('timer-warning');
    if (remaining <= 0) { endSession(); return; }
  };
  update();
  state.timerInterval = setInterval(update, 1000);
  document.addEventListener('visibilitychange', _onVisibilityChange);
}

function _onVisibilityChange() {
  if (!document.hidden && state.timerEndTime !== null && Date.now() >= state.timerEndTime) {
    endSession();
  }
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  state.timerEndTime  = null;
  document.removeEventListener('visibilitychange', _onVisibilityChange);
}

function setStatus(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `field-status ${type}`;
}

// ── Security code modal ────────────────────────────────────────────────────────
document.getElementById('security-btn').addEventListener('click', async () => {
  const groups = await cryptoMgr.securityCode();
  if (!groups) return;
  const display = document.getElementById('security-code-display');
  display.innerHTML = groups.map((g) => `<span class="code-group">${g}</span>`).join('');
  openModal('security-modal');
});

document.getElementById('security-modal-close').addEventListener('click', () => closeModal('security-modal'));
document.getElementById('security-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('security-modal');
});
