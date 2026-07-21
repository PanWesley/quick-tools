const MAX_BODY_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;
const MAX_SNAPSHOT_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const PLATFORMS = ['jd', 'taobao', 'tmall', 'pdd'];

export function allowedOrigin(request, env) {
  if (typeof env?.ALLOWED_ORIGINS !== 'string') return null;

  const origins = env.ALLOWED_ORIGINS
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origins.length === 0) return null;
  if (origins.includes('*')) return '*';

  const headerOrigin = request.headers.get('Origin');
  let requestOrigin = headerOrigin;

  if (!requestOrigin) {
    try {
      requestOrigin = new URL(request.url).origin;
    } catch {
      return null;
    }
  }

  return origins.includes(requestOrigin) ? requestOrigin : null;
}

export function json(data, status, origin, env) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  });
  const request = {
    headers: { get: (name) => name.toLowerCase() === 'origin' ? origin : null }
  };
  const responseOrigin = allowedOrigin(request, env);
  if (responseOrigin === origin && responseOrigin !== null) {
    headers.set('Access-Control-Allow-Origin', responseOrigin);
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Price-Client-ID');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(code, message, status, origin, env, retryable = false) {
  return json({ error: { code, message, retryable } }, status, origin, env);
}

export function optionsResponse(origin, env) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  });
  const request = {
    headers: { get: (name) => name.toLowerCase() === 'origin' ? origin : null }
  };
  const responseOrigin = allowedOrigin(request, env);
  if (responseOrigin === origin && responseOrigin !== null) {
    headers.set('Access-Control-Allow-Origin', responseOrigin);
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Price-Client-ID');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(null, { status: 204, headers });
}

export function isObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasOnlyKeys(value, keys) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

export function isValidPlatform(platform) {
  return PLATFORMS.includes(platform);
}

export function isValidItemId(itemId) {
  return typeof itemId === 'string' && itemId.length > 0 && itemId.length <= 128;
}

export function isValidPrice(price) {
  return typeof price === 'number' && Number.isFinite(price) && price > 0 && price <= 1000000;
}

export function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

export function medianPrice(snapshots) {
  const prices = (snapshots || [])
    .map((snapshot) => snapshot?.finalPrice)
    .filter(isValidPrice)
    .sort((a, b) => a - b);

  if (prices.length === 0) return 0;
  const middle = Math.floor(prices.length / 2);
  if (prices.length % 2 === 1) return prices[middle];
  return (prices[middle - 1] + prices[middle]) / 2;
}

export function isSuspiciousPrice(price, snapshots) {
  const recent = (snapshots || []).filter((snapshot) => isValidPrice(snapshot?.finalPrice)).slice(-50);
  if (recent.length < 5) return false;
  const median = medianPrice(recent);
  if (!median) return false;
  return price < median * 0.25 || price > median * 4;
}

export async function readJson(request) {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return {
      ok: false,
      status: 415,
      code: 'unsupported_media_type',
      message: 'Content-Type must be application/json.'
    };
  }
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: 'Request body is too large.' };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large', message: 'Request body is too large.' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, code: 'invalid_json', message: 'Request body must be valid JSON.' };
  }
}

export function extractFirstUrl(input) {
  const text = String(input || '').trim();
  const match = text.match(/https?:\/\/[^\s"'<>「」『』【】]+/i);
  if (!match) return '';
  let url = match[0];
  while (/[.,;!?，。；、)）\]】」』]$/.test(url)) {
    url = url.slice(0, -1);
  }
  return url.length <= MAX_URL_LENGTH ? url : '';
}

export function extractProductTitle(input) {
  const text = String(input || '');
  const cornerMatch = text.match(/「([^」]+)」/);
  if (cornerMatch && cornerMatch[1]) {
    const title = cornerMatch[1].trim();
    return title.length <= MAX_TITLE_LENGTH ? title : title.slice(0, MAX_TITLE_LENGTH);
  }
  const doubleQuoteMatch = text.match(/"([^"]{4,80})"/);
  if (doubleQuoteMatch && doubleQuoteMatch[1]) {
    return doubleQuoteMatch[1].trim();
  }
  return '';
}

export function detectPlatformFromText(input) {
  const text = String(input || '');
  if (/【京东】|京东\s*(APP|速购|超市)/.test(text)) return 'jd';
  if (/【淘宝】|淘宝\s*(APP|特价)/.test(text)) return 'taobao';
  if (/【天猫】|天猫/.test(text)) return 'tmall';
  if (/【拼多多】|拼多多|拼夕夕/.test(text)) return 'pdd';
  if (/￥[A-Za-z0-9]{8,}￥/.test(text)) return 'taobao';
  return '';
}

export function normalizePlatformLabel(platform) {
  return {
    jd: '京东',
    taobao: '淘宝',
    tmall: '天猫',
    pdd: '拼多多'
  }[platform] || '未知平台';
}

export function productKey(platform, itemId) {
  return `product:${platform}:${itemId}`;
}

export function snapshotsKey(platform, itemId) {
  return `snapshots:${platform}:${itemId}`;
}

export function snapshotKey(platform, itemId, capturedAtIso) {
  return `snapshot:${platform}:${itemId}:${capturedAtIso}`;
}

export { MAX_SNAPSHOT_AGE_MS, MAX_TITLE_LENGTH, MAX_URL_LENGTH, PLATFORMS };
