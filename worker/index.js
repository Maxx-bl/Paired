const ALLOWED_ORIGINS = new Set([
  'https://paired.synae.dev',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
]);

const FIREBASE_PROJECT_ID = 'paired-a18ad';
const FIREBASE_KEYS_URL   = 'https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com';

function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.has(origin) ? origin : 'https://paired.synae.dev',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}

async function verifyFirebaseToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  let header, payload;
  try {
    header  = JSON.parse(atob(parts[0]));
    payload = JSON.parse(atob(parts[1]));
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now)                                                          return false;
  if (payload.iat > now + 300)                                                    return false;
  if (payload.aud !== FIREBASE_PROJECT_ID)                                        return false;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`)   return false;
  if (!payload.sub)                                                               return false;

  const keysRes = await fetch(FIREBASE_KEYS_URL);
  if (!keysRes.ok) return false;
  const { keys } = await keysRes.json();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return false;

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
  } catch {
    return false;
  }

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const b64  = parts[2].replace(/-/g, '+').replace(/_/g, '/');
  const sig  = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
}

export default {
  async fetch(request, env) {
    const CORS = corsHeaders(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    const authHeader = request.headers.get('Authorization') ?? '';
    const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return new Response('Unauthorized', { status: 401, headers: CORS });
    }
    if (!await verifyFirebaseToken(token)) {
      return new Response('Unauthorized', { status: 401, headers: CORS });
    }

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );

    if (!res.ok) {
      return new Response('TURN credential fetch failed', { status: 502, headers: CORS });
    }

    const { iceServers } = await res.json();

    return new Response(JSON.stringify(iceServers), {
      headers: {
        ...CORS,
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};
