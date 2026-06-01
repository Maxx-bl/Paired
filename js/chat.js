// ── Init ──────────────────────────────────────────────────────────────────────

const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches;

function initChatScreen(partnerUsername) {
  document.getElementById('chat-with').textContent   = partnerUsername;
  document.getElementById('messages').innerHTML       = '';
  document.getElementById('message-input').disabled  = false;
  document.getElementById('send-btn').disabled        = false;
  document.getElementById('timer').classList.remove('timer-warning');

  // Reset drop hint
  const hint = document.getElementById('drop-hint');
  const hintText = document.getElementById('drop-hint-text');
  hint.style.opacity        = '';
  hint.style.pointerEvents  = '';
  hint.style.textDecoration = '';
  hintText.classList.remove('p2p-ready');
  hintText.textContent = isTouch
    ? 'Appuyer pour joindre un fichier'
    : 'Glisser un fichier ici ou cliquer';

  appendSystemMessage('Chiffré de bout en bout — messages et fichiers détruits à la déconnexion');
  setupDragAndDrop();
}

// ── Messages ──────────────────────────────────────────────────────────────────

function appendMessage({ text, sender, timestamp, isOwn }) {
  const el     = document.createElement('div');
  el.className = `msg ${isOwn ? 'msg-own' : 'msg-other'}`;

  const bubble       = document.createElement('div');
  bubble.className   = 'bubble';
  bubble.textContent = text;

  const meta       = document.createElement('div');
  meta.className   = 'msg-meta';
  meta.textContent = formatTime(timestamp);

  el.appendChild(bubble);
  el.appendChild(meta);
  getMsgsEl().appendChild(el);
  scrollBottom();
}

function appendFileMessage({ blob, name, size, isOwn }) {
  const el     = document.createElement('div');
  el.className = `msg ${isOwn ? 'msg-own' : 'msg-other'}`;

  const bubble     = document.createElement('div');
  bubble.className = 'bubble bubble-file';

  const badge       = document.createElement('span');
  badge.className   = 'file-badge';
  badge.textContent = getFileExt(name);

  const info     = document.createElement('div');
  info.className = 'file-info';

  const fname       = document.createElement('span');
  fname.className   = 'file-name';
  fname.textContent = name;

  const fsize       = document.createElement('span');
  fsize.className   = 'file-size';
  fsize.textContent = formatBytes(size);

  info.appendChild(fname);
  info.appendChild(fsize);

  if (blob) {
    const url      = URL.createObjectURL(blob);
    const dl       = document.createElement('a');
    dl.href        = url;
    dl.download    = name;
    dl.className   = 'btn-dl';
    dl.textContent = 'Télécharger';
    info.appendChild(dl);
  }

  bubble.appendChild(badge);
  bubble.appendChild(info);
  el.appendChild(bubble);
  getMsgsEl().appendChild(el);
  scrollBottom();
}

function appendSystemMessage(text) {
  const el       = document.createElement('div');
  el.className   = 'msg-system';
  el.textContent = text;
  getMsgsEl().appendChild(el);
  scrollBottom();
}

// ── Progress ──────────────────────────────────────────────────────────────────

function showProgress(filename, pct, isSend) {
  document.getElementById('progress-container').style.display    = 'block';
  document.getElementById('progress-filename').textContent       = filename;
  document.getElementById('progress-direction').textContent      = isSend ? 'Envoi' : 'Réception';
  document.getElementById('file-progress').style.width           = `${Math.round(pct * 100)}%`;
  document.getElementById('progress-pct').textContent            = `${Math.round(pct * 100)}%`;
}

function hideProgress() {
  document.getElementById('progress-container').style.display = 'none';
}

// ── Send message ──────────────────────────────────────────────────────────────

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text  = input.value.trim();
  if (!text || !state.roomId || !state.cryptoReady) return;

  appendMessage({ text, sender: state.username, timestamp: Date.now(), isOwn: true });
  input.value = '';
  await sendEncryptedMessage(text);
}

// ── Drag & drop + file picker ─────────────────────────────────────────────────

function setupDragAndDrop() {
  const chatScreen = document.getElementById('screen-chat');
  const overlay    = document.getElementById('drop-overlay');
  const hideOverlay = () => overlay.classList.remove('visible');

  // Drag & drop (desktop only — no-op on touch devices)
  if (!isTouch) {
    chatScreen.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!state.partnerLeft) overlay.classList.add('visible');
    });
    chatScreen.addEventListener('dragleave', (e) => {
      if (!chatScreen.contains(e.relatedTarget)) hideOverlay();
    });
    chatScreen.addEventListener('dragover', (e) => e.preventDefault());
    chatScreen.addEventListener('drop', async (e) => {
      e.preventDefault();
      hideOverlay();
      if (state.partnerLeft) return;
      for (const file of Array.from(e.dataTransfer.files)) await sendFile(file);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideOverlay(); });
  }

  // File picker — works on both desktop and mobile
  document.getElementById('drop-hint').addEventListener('click', () => {
    if (state.partnerLeft) return;
    const picker    = document.createElement('input');
    picker.type     = 'file';
    picker.multiple = true;
    picker.onchange = async (e) => {
      for (const file of Array.from(e.target.files)) await sendFile(file);
    };
    picker.click();
  });
}

const MAX_FILE_SIZE = 5 * 1024 ** 3;

async function sendFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    appendSystemMessage(`« ${file.name} » dépasse la limite de 5 Go et n'a pas été envoyé.`);
    return;
  }
  if (!webrtcMgr.isReady()) {
    appendSystemMessage('La connexion P2P n\'est pas encore prête. Patientez quelques secondes et réessayez.');
    return;
  }
  appendFileMessage({ name: file.name, size: file.size, isOwn: true });
  try {
    await webrtcMgr.sendFile(file);
  } catch (err) {
    appendSystemMessage(`Erreur lors de l'envoi de « ${file.name} » : ${err.message}`);
  }
}

// ── Leave ─────────────────────────────────────────────────────────────────────

document.getElementById('leave-btn').addEventListener('click', () => {
  if (confirm('Quitter ? Tous les messages et fichiers seront détruits définitivement.')) {
    endSession();
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────

function getMsgsEl()    { return document.getElementById('messages'); }
function scrollBottom() { const el = getMsgsEl(); el.scrollTop = el.scrollHeight; }

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (bytes < 1024)      return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}

function getFileExt(name) {
  const ext = name.split('.').pop();
  return ext && ext.length <= 5 ? ext : 'file';
}
