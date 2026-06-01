// Blob.arrayBuffer() absent sur iOS < 14 — fallback FileReader
function readAsArrayBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const TURN_WORKER_URL = 'https://paired-turn.max13-bl.workers.dev/';

const STUN_ONLY = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

async function fetchIceServers() {
  try {
    const res = await fetch(TURN_WORKER_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const servers = await res.json();
    console.log('[TURN] credentials OK:', JSON.stringify(servers));
    return servers;
  } catch (err) {
    console.warn('[TURN] credentials unavailable, falling back to STUN only:', err);
    return STUN_ONLY;
  }
}

const CHUNK_SIZE      = 256 * 1024;  // 256 KB
const HIGH_WATERMARK  = 1024 * 1024; // 1 MB — pause l'envoi au-delà
const LOW_WATERMARK   = 256 * 1024;  // 256 KB — reprend l'envoi en-dessous

class WebRTCManager {
  constructor() {
    // Signaling callbacks — set by app.js before use
    this.sendOffer  = null;
    this.sendAnswer = null;
    this.sendIce    = null;

    // UI callbacks
    this.onFileReceived    = null;
    this.onSendProgress    = null;
    this.onReceiveProgress = null;
    this.onChannelOpen     = null;
    this.onConnectionType  = null;

    this.pc         = null;
    this.channel    = null;
    this.iceServers = STUN_ONLY;

    this._recvChunks = [];
    this._recvSize   = 0;
    this._recvMeta   = null;
    this._pendingIce = [];
  }

  async loadIceServers() {
    this.iceServers = await fetchIceServers();
  }

  _createPC() {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendIce?.(candidate);
    };
    pc.oniceconnectionstatechange = () => {
      console.log('[ICE] state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this._detectConnectionType();
      }
    };
    pc.onconnectionstatechange = () => console.log('[PC]  state:', pc.connectionState);
    return pc;
  }

  async createOffer() {
    this.pc      = this._createPC();
    this.channel = this.pc.createDataChannel('files', { ordered: true });
    this._setupChannel(this.channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.sendOffer?.(this.pc.localDescription);
  }

  async handleOffer(offer) {
    this.pc = this._createPC();
    this.pc.ondatachannel = (e) => {
      this.channel = e.channel;
      this._setupChannel(this.channel);
    };
    await this.pc.setRemoteDescription(offer);
    await this._flushPendingIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.sendAnswer?.(this.pc.localDescription);
  }

  async handleAnswer(answer) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(answer);
    await this._flushPendingIce();
  }

  async addIceCandidate(candidate) {
    if (this.pc?.remoteDescription) {
      await this.pc.addIceCandidate(candidate);
    } else {
      this._pendingIce.push(candidate);
    }
  }

  async _flushPendingIce() {
    for (const c of this._pendingIce) await this.pc.addIceCandidate(c);
    this._pendingIce = [];
  }

  _setupChannel(ch) {
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = LOW_WATERMARK;
    ch.onopen     = () => { console.log('[DC] channel open'); this.onChannelOpen?.(); };
    ch.onclose    = () => console.log('[DC] channel closed');
    ch.onerror    = (e) => console.error('[DC] channel error:', e);

    ch.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (msg.type === 'file-start') {
          this._recvMeta   = msg;
          this._recvChunks = [];
          this._recvSize   = 0;
        } else if (msg.type === 'file-end') {
          const blob = new Blob(this._recvChunks, { type: this._recvMeta.mime || 'application/octet-stream' });
          this.onFileReceived?.({ blob, name: this._recvMeta.name, size: this._recvMeta.size });
          this._recvMeta = null;
        }
      } else {
        this._recvChunks.push(e.data);
        this._recvSize += e.data.byteLength;
        if (this._recvMeta) {
          this.onReceiveProgress?.(this._recvSize / this._recvMeta.size, this._recvMeta.name);
        }
      }
    };
  }

  async sendFile(file) {
    if (!this.isReady()) throw new Error('Canal P2P non disponible');

    this.channel.send(JSON.stringify({
      type: 'file-start',
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    }));

    let offset = 0;
    while (offset < file.size) {
      if (this.channel.bufferedAmount > HIGH_WATERMARK) {
        await new Promise((resolve) => { this.channel.onbufferedamountlow = resolve; });
        this.channel.onbufferedamountlow = null;
      }
      const slice = await readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
      this.channel.send(slice);
      offset += CHUNK_SIZE;
      this.onSendProgress?.(Math.min(offset / file.size, 1), file.name);
    }

    this.channel.send(JSON.stringify({ type: 'file-end' }));
  }

  async _detectConnectionType() {
    try {
      const stats = await this.pc.getStats();
      let localCandidateId = null;
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.state === 'succeeded' || r.nominated)) {
          localCandidateId = r.localCandidateId;
        }
      });
      if (!localCandidateId) return;
      const local = stats.get(localCandidateId);
      this.onConnectionType?.(local?.candidateType === 'relay' ? 'TURN' : 'P2P');
    } catch {}
  }

  isReady() {
    return this.channel?.readyState === 'open';
  }

  destroy() {
    this.channel?.close();
    this.pc?.close();
    this.channel     = null;
    this.pc          = null;
    this._pendingIce = [];
  }
}
