const ALLOWED_ORIGINS = new Set([
  'https://paired.synae.dev',
  'http://127.0.0.1:5500',
  'http://localhost:5500',
]);

function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://paired.synae.dev',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
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

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.TURN_KEY_API_TOKEN}`,
          'Content-Type': 'application/json',
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
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};
