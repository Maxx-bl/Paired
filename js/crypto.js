class CryptoManager {
  constructor() {
    this.keyPair = null;
    this.sharedKey = null;
    this._partnerPublicKeyB64 = null;
  }

  async generateKeyPair() {
    this.keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey']
    );
    const exported = await crypto.subtle.exportKey('spki', this.keyPair.publicKey);
    return this._toB64(new Uint8Array(exported));
  }

  async deriveSharedKey(partnerPublicKeyB64) {
    this._partnerPublicKeyB64 = partnerPublicKeyB64;
    const partnerKey = await crypto.subtle.importKey(
      'spki',
      this._fromB64(partnerPublicKeyB64),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
    this.sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: partnerKey },
      this.keyPair.privateKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.sharedKey, encoded);
    const out = new Uint8Array(12 + ciphertext.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ciphertext), 12);
    return this._toB64(out);
  }

  async decrypt(b64) {
    const buf = this._fromB64(b64);
    const iv = buf.slice(0, 12);
    const ct = buf.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.sharedKey, ct);
    return new TextDecoder().decode(plain);
  }

  async securityCode() {
    if (!this._partnerPublicKeyB64 || !this.keyPair) return null;
    const myKeyRaw = await crypto.subtle.exportKey('spki', this.keyPair.publicKey);
    const myKeyB64 = this._toB64(new Uint8Array(myKeyRaw));
    const [k1, k2] = [myKeyB64, this._partnerPublicKeyB64].sort();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(k1 + k2));
    const bytes = new Uint8Array(hash);
    const groups = [];
    for (let i = 0; i < 5; i++) {
      const val = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) % 100000;
      groups.push(String(val).padStart(5, '0'));
    }
    return groups;
  }

  _toB64(u8) {
    return btoa(String.fromCharCode(...u8));
  }

  _fromB64(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
}
