// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  username:      null,
  partnerUsername: null,
  roomId:        null,
  role:          null,   // 'initiator' | 'receiver'
  cryptoReady:   false,
  timerInterval: null,
  pendingRoomId: null,   // roomId we created while waiting for partner
  pendingPartner: null,  // partner we sent an invite to
  leaving:       false,  // true while endSession runs (prevents ghost notifications)
  partnerLeft:   false,  // true once the partner disconnects
};

// ── Instances ─────────────────────────────────────────────────────────────────
const cryptoMgr = new CryptoManager();
const webrtcMgr = new WebRTCManager();

webrtcMgr.onChannelOpen = () => {
  const hint = document.getElementById('drop-hint-text');
  hint.textContent = 'Connexion directe active — glisser un fichier ici';
  hint.classList.add('p2p-ready');
};
webrtcMgr.onFileReceived = ({ blob, name, size }) => {
  hideProgress();
  appendFileMessage({ blob, name, size, isOwn: false });
};
webrtcMgr.onReceiveProgress = (pct, name) => showProgress(name, pct, false);
webrtcMgr.onSendProgress    = (pct, name) => {
  showProgress(name, pct, true);
  if (pct >= 1) setTimeout(hideProgress, 800);
};

// ── Screen management ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── Username availability (direct Firebase read) ──────────────────────────────
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

  // Listen for incoming invitations (fires immediately if one already exists)
  const invRef = db.ref(`invites/${username}`);
  await invRef.onDisconnect().remove();
  invRef.on('value', handleIncomingInvite);
}

// ── Request connection to partner ─────────────────────────────────────────────
async function requestConnection(partnerUsername) {
  const roomId = crypto.randomUUID();
  state.pendingRoomId  = roomId;
  state.pendingPartner = partnerUsername;

  // Register room cleanup on disconnect (even while partial)
  await db.ref(`rooms/${roomId}`).onDisconnect().remove();

  // Write our public key to the room
  const myPublicKey = await cryptoMgr.generateKeyPair();
  await db.ref(`rooms/${roomId}/keys/${state.username}`).set(myPublicKey);

  // Write invitation
  const invRef = db.ref(`invites/${partnerUsername}`);
  await invRef.onDisconnect().remove();
  await invRef.set({
    from:      state.username,
    roomId,
    ts: firebase.database.ServerValue.TIMESTAMP,
  });

  // Wait for partner to accept (they write their public key)
  db.ref(`rooms/${roomId}/keys/${partnerUsername}`).on('value', async (snap) => {
    if (!snap.exists()) return;
    db.ref(`rooms/${roomId}/keys/${partnerUsername}`).off();

    await cryptoMgr.deriveSharedKey(snap.val());
    state.cryptoReady = true;
    await enterRoom(roomId, partnerUsername, 'initiator');
  });
}

// ── Handle incoming invitation ────────────────────────────────────────────────
async function handleIncomingInvite(snap) {
  if (!snap.exists() || state.roomId) return;
  const { from, roomId } = snap.val();
  if (!from || !roomId) return;

  // Mutual invitation: both users entered each other's username simultaneously.
  // Alphabetically smaller username becomes initiator (uses their own room).
  if (state.pendingRoomId && state.pendingPartner === from) {
    if (state.username < from) return; // we're the initiator, ignore their invite
    // We're the receiver. Cancel our outgoing invite.
    await db.ref(`invites/${from}`).remove();
    state.pendingRoomId  = null;
    state.pendingPartner = null;
  }

  // Read initiator's public key (written before the invite)
  const initiatorKeySnap = await db.ref(`rooms/${roomId}/keys/${from}`).once('value');
  if (!initiatorKeySnap.exists()) return;

  // Generate our key pair and derive shared secret
  const myPublicKey = await cryptoMgr.generateKeyPair();
  await cryptoMgr.deriveSharedKey(initiatorKeySnap.val());
  state.cryptoReady = true;

  // Write our key (this signals acceptance to the initiator)
  await db.ref(`rooms/${roomId}/keys/${state.username}`).set(myPublicKey);

  // Clean up the invite we just processed
  await db.ref(`invites/${state.username}`).remove();

  await enterRoom(roomId, from, 'receiver');
}

// ── Enter room ────────────────────────────────────────────────────────────────
async function enterRoom(roomId, partnerUsername, role) {
  state.roomId         = roomId;
  state.partnerUsername = partnerUsername;
  state.role           = role;
  state.pendingRoomId  = null;
  state.pendingPartner = null;

  // Both users register room deletion on disconnect (first to disconnect cleans up)
  await db.ref(`rooms/${roomId}`).onDisconnect().remove();

  // Initiator writes the room metadata
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

  if (role === 'initiator') {
    await webrtcMgr.createOffer();
  }
}

// ── WebRTC signaling via Firebase ─────────────────────────────────────────────
function setupWebRTCSignaling(roomId, role) {
  const myIcePath   = `rooms/${roomId}/webrtc/ice_${role}`;
  const peerRole    = role === 'initiator' ? 'receiver' : 'initiator';
  const peerIcePath = `rooms/${roomId}/webrtc/ice_${peerRole}`;

  webrtcMgr.sendOffer  = (sdp) => db.ref(`rooms/${roomId}/webrtc/offer`).set({ sdp: sdp.sdp, type: sdp.type });
  webrtcMgr.sendAnswer = (sdp) => db.ref(`rooms/${roomId}/webrtc/answer`).set({ sdp: sdp.sdp, type: sdp.type });
  webrtcMgr.sendIce    = (c)   => db.ref(myIcePath).push(c.toJSON ? c.toJSON() : c);

  // Receive peer ICE candidates
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
    if (sender === state.username) return; // already shown locally
    try {
      const text = await cryptoMgr.decrypt(ciphertext);
      appendMessage({ text, sender, timestamp, isOwn: false });
    } catch { /* undecryptable = skip */ }
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
      hint.style.opacity = '0.35';
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
    sender:     state.username,
    ciphertext,
    timestamp:  firebase.database.ServerValue.TIMESTAMP,
  });
}

// ── End session ───────────────────────────────────────────────────────────────
async function endSession() {
  state.leaving = true;
  stopTimer();
  webrtcMgr.destroy();

  const { roomId, username, pendingPartner } = state;

  // Reset state immediately to block re-entrant calls
  state.roomId         = null;
  state.partnerUsername = null;
  state.role           = null;
  state.cryptoReady    = false;
  state.pendingRoomId  = null;
  state.pendingPartner = null;
  state.partnerLeft    = false;

  if (roomId) {
    await db.ref(`rooms/${roomId}`).onDisconnect().cancel();
    await db.ref(`rooms/${roomId}`).remove();
  }

  if (pendingPartner) {
    await db.ref(`invites/${pendingPartner}`).onDisconnect().cancel();
    await db.ref(`invites/${pendingPartner}`).remove();
  }

  if (username) {
    db.ref(`invites/${username}`).off();
    await db.ref(`invites/${username}`).onDisconnect().cancel();
    await db.ref(`presence/${username}`).onDisconnect().cancel();
    await db.ref(`presence/${username}`).remove();
  }

  state.username = null;
  state.leaving  = false;

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent  = text;
  el.className    = `field-status ${type}`;
}
