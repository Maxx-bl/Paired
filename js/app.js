// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  username:        null,
  partnerUsername: null,
  roomId:          null,
  role:            null,
  cryptoReady:     false,
  timerInterval:   null,
  pendingRoomId:   null,
  pendingPartner:  null,
  pendingKeyRef:   null,  // Firebase ref listened for partner's key acceptance
  leaving:         false, // true during endSession (blocks ghost notifications)
  partnerLeft:     false,
  joiningRoom:     false, // lock against concurrent room joins
};

// ── Instances ─────────────────────────────────────────────────────────────────
const cryptoMgr = new CryptoManager();
const webrtcMgr = new WebRTCManager();

webrtcMgr.onChannelOpen = () => {
  const hint = document.getElementById('drop-hint-text');
  if (!hint) return;
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  hint.textContent = isTouch
    ? 'Connexion directe active — appuyer pour joindre un fichier'
    : 'Connexion directe active — glisser un fichier ici';
  hint.classList.add('p2p-ready');
};
webrtcMgr.onFileReceived    = ({ blob, name, size }) => { hideProgress(); appendFileMessage({ blob, name, size, isOwn: false }); };
webrtcMgr.onReceiveProgress = (pct, name) => showProgress(name, pct, false);
webrtcMgr.onSendProgress    = (pct, name) => { showProgress(name, pct, true); if (pct >= 1) setTimeout(hideProgress, 800); };

// ── UUID (crypto.randomUUID absent sur certains navigateurs mobiles) ──────────
function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
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

  // Listen for incoming invitations — fires immediately if one already exists
  const invRef = db.ref(`invites/${username}`);
  await invRef.onDisconnect().remove();
  invRef.on('value', handleIncomingInvite);
}

// ── Unregister user (frees the username, cleans Firebase presence) ─────────────
async function unregisterUser() {
  const { username } = state;
  if (!username) return;

  state.username = null;

  db.ref(`invites/${username}`).off();
  await db.ref(`invites/${username}`).onDisconnect().cancel();
  await db.ref(`presence/${username}`).onDisconnect().cancel();
  await db.ref(`presence/${username}`).remove();
}

// ── Cancel a pending connection request (waiting state) ───────────────────────
async function cancelPendingConnection() {
  const { pendingRoomId, pendingPartner, pendingKeyRef } = state;

  // Stop listening for partner's key
  pendingKeyRef?.off();
  state.pendingKeyRef  = null;
  state.pendingRoomId  = null;
  state.pendingPartner = null;

  if (pendingRoomId) {
    await db.ref(`rooms/${pendingRoomId}`).onDisconnect().cancel();
    await db.ref(`rooms/${pendingRoomId}`).remove();
  }
  if (pendingPartner) {
    await db.ref(`invites/${pendingPartner}`).onDisconnect().cancel();
    await db.ref(`invites/${pendingPartner}`).remove();
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
async function requestConnection(partnerUsername) {
  const roomId = generateUUID();
  state.pendingRoomId  = roomId;
  state.pendingPartner = partnerUsername;

  await db.ref(`rooms/${roomId}`).onDisconnect().remove();

  const myPublicKey = await cryptoMgr.generateKeyPair();
  await db.ref(`rooms/${roomId}/keys/${state.username}`).set(myPublicKey);

  const invRef = db.ref(`invites/${partnerUsername}`);
  await invRef.onDisconnect().remove();
  await invRef.set({ from: state.username, roomId, ts: firebase.database.ServerValue.TIMESTAMP });

  // Listen for partner's key — their acceptance signal
  const partnerKeyRef = db.ref(`rooms/${roomId}/keys/${partnerUsername}`);
  state.pendingKeyRef = partnerKeyRef;

  partnerKeyRef.on('value', async (snap) => {
    if (!snap.exists()) return;
    // Guard: user may have clicked back between the async write and this callback
    if (!state.pendingRoomId || state.joiningRoom || state.leaving) return;

    partnerKeyRef.off();
    state.pendingKeyRef = null;

    state.joiningRoom = true;
    try {
      await cryptoMgr.deriveSharedKey(snap.val());
      state.cryptoReady = true;
      await enterRoom(roomId, partnerUsername, 'initiator');
    } finally {
      state.joiningRoom = false;
    }
  });
}

// ── Handle incoming invitation ────────────────────────────────────────────────
async function handleIncomingInvite(snap) {
  if (!snap.exists() || state.roomId || state.joiningRoom || state.leaving) return;
  const { from, roomId } = snap.val();
  if (!from || !roomId) return;

  // Mutual invitation: alphabetically smaller username becomes initiator
  if (state.pendingRoomId && state.pendingPartner === from) {
    if (state.username < from) return; // we're initiator, ignore their invite
    // We're receiver — cancel our outgoing invite
    await cancelPendingConnection();
  }

  state.joiningRoom = true;
  try {
    const initiatorKeySnap = await db.ref(`rooms/${roomId}/keys/${from}`).once('value');
    if (!initiatorKeySnap.exists() || state.leaving) return;

    const myPublicKey = await cryptoMgr.generateKeyPair();
    await cryptoMgr.deriveSharedKey(initiatorKeySnap.val());
    state.cryptoReady = true;

    await db.ref(`rooms/${roomId}/keys/${state.username}`).set(myPublicKey);
    await db.ref(`invites/${state.username}`).remove();

    await enterRoom(roomId, from, 'receiver');
  } finally {
    state.joiningRoom = false;
  }
}

// ── Enter room ────────────────────────────────────────────────────────────────
async function enterRoom(roomId, partnerUsername, role) {
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

  setupWebRTCSignaling(roomId, role);
  setupMessageListener(roomId);
  setupPartnerLeftListener(roomId);

  showScreen('chat');
  initChatScreen(partnerUsername);
  startTimer(3600);

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

// ── Message listener ──────────────────────────────────────────────────────────
function setupMessageListener(roomId) {
  db.ref(`rooms/${roomId}/messages`).on('child_added', async (snap) => {
    const { sender, ciphertext, timestamp } = snap.val();
    if (sender === state.username) return;
    try {
      const text = await cryptoMgr.decrypt(ciphertext);
      appendMessage({ text, sender, timestamp, isOwn: false });
    } catch { /* skip undecryptable */ }
  });
}

// ── Partner-left detection ────────────────────────────────────────────────────
function setupPartnerLeftListener(roomId) {
  let metaWasSet = false;
  db.ref(`rooms/${roomId}/meta`).on('value', (snap) => {
    if (snap.exists()) {
      metaWasSet = true;
    } else if (metaWasSet && state.roomId && !state.leaving) {
      state.partnerLeft = true;
      appendSystemMessage(`${state.partnerUsername} a quitté la conversation.`);
      document.getElementById('message-input').disabled = true;
      document.getElementById('send-btn').disabled = true;
      const hint = document.getElementById('drop-hint');
      hint.style.opacity       = '0.35';
      hint.style.pointerEvents = 'none';
      hint.style.textDecoration = 'none';
      stopTimer();
    }
  });
}

// ── Send encrypted message ────────────────────────────────────────────────────
async function sendEncryptedMessage(text) {
  if (!state.roomId || !state.cryptoReady) return;
  const ciphertext = await cryptoMgr.encrypt(text);
  await db.ref(`rooms/${state.roomId}/messages`).push({
    sender:    state.username,
    ciphertext,
    timestamp: firebase.database.ServerValue.TIMESTAMP,
  });
}

// ── End session (leave chat room) ─────────────────────────────────────────────
async function endSession() {
  if (state.leaving) return;
  state.leaving = true;
  stopTimer();
  webrtcMgr.destroy();

  const { roomId } = state;

  state.roomId          = null;
  state.partnerUsername = null;
  state.role            = null;
  state.cryptoReady     = false;
  state.pendingRoomId   = null;
  state.pendingPartner  = null;
  state.pendingKeyRef   = null;
  state.partnerLeft     = false;

  if (roomId) {
    await db.ref(`rooms/${roomId}`).onDisconnect().cancel();
    await db.ref(`rooms/${roomId}`).remove();
  }

  await unregisterUser();

  state.leaving = false;

  showScreen('login');
  resetLoginScreens();
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer(seconds) {
  let remaining = seconds;
  const el = document.getElementById('timer');
  state.timerInterval = setInterval(() => {
    remaining--;
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
    if (remaining <= 300) el.classList.add('timer-warning');
    if (remaining <= 0) endSession();
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

function setStatus(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `field-status ${type}`;
}
