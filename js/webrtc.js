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

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80?transport=tcp',  username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443',              username: 'openrelayproject', credential: 'openrelayproject' },
];

const CHUNK_SIZE = 64 * 1024;
const BUFFER_THRESHOLD = 16 * 1024 * 1024;

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

    this.pc      = null;
    this.channel = null;

    this._recvChunks = [];
    this._recvSize   = 0;
    this._recvMeta   = null;
  }

  _createPC() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.sendIce?.(candidate);
    };
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
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.sendAnswer?.(this.pc.localDescription);
  }

  async handleAnswer(answer) {
    await this.pc?.setRemoteDescription(answer);
  }

  async addIceCandidate(candidate) {
    if (this.pc?.remoteDescription) {
      await this.pc.addIceCandidate(candidate);
    }
  }

  _setupChannel(ch) {
    ch.binaryType = 'arraybuffer';
    ch.onopen     = () => this.onChannelOpen?.();

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
      while (this.channel.bufferedAmount > BUFFER_THRESHOLD) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const slice = await readAsArrayBuffer(file.slice(offset, offset + CHUNK_SIZE));
      this.channel.send(slice);
      offset += CHUNK_SIZE;
      this.onSendProgress?.(Math.min(offset / file.size, 1), file.name);
    }

    this.channel.send(JSON.stringify({ type: 'file-end' }));
  }

  isReady() {
    return this.channel?.readyState === 'open';
  }

  destroy() {
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc      = null;
  }
}
