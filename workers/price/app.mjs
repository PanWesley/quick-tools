import {
  allowedOrigin,
  json,
  errorResponse,
  optionsResponse,
  readJson,
  isObject,
  hasOnlyKeys,
  isValidPlatform,
  isValidItemId,
  isValidPrice,
  normalizeTitle,
  isSuspiciousPrice,
  extractFirstUrl,
  extractProductTitle,
  detectPlatformFromText,
  normalizePlatformLabel,
  productKey,
  snapshotsKey,
  MAX_SNAPSHOT_AGE_MS
} from './core.mjs';

const SHORT_LINK_HOSTS = {
  '3.cn': 'jd',
  'u.jd.com': 'jd',
  'jd.cn': 'jd',
  'union-click.jd.com': 'jd',
  'm.tb.cn': 'taobao',
  'e.tb.cn': 'taobao',
  'tb.cn': 'taobao',
  's.click.taobao.com': 'taobao',
  'a.m.taobao.com': 'taobao',
  'h5.m.taobao.com': 'taobao',
  'p.pinduoduo.com': 'pdd',
  'mobile.yangkeduo.com': 'pdd',
  'yangkeduo.com': 'pdd'
};

const MAX_REDIRECT_DEPTH = 5;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SHORT_LINK_HTML_BYTES = 256 * 1024;
const PRICE_CACHE_TTL_SECONDS = 6 * 3600;
const SNAPSHOT_DEDUP_WINDOW_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS_PER_PRODUCT = 500;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

function platformFromHost(hostname) {
  const host = hostname.toLowerCase();
  const hosts = Object.keys(SHORT_LINK_HOSTS);
  for (let i = 0; i < hosts.length; i++) {
    const shortHost = hosts[i];
    if (host === shortHost || host.endsWith('.' + shortHost)) {
      return SHORT_LINK_HOSTS[shortHost];
    }
  }
  if (host === 'item.jd.com' || host.endsWith('.jd.com') || host === 'jd.com') return 'jd';
  if (host === 'item.taobao.com' || host.endsWith('.taobao.com') || host === 'taobao.com') return 'taobao';
  if (host === 'detail.tmall.com' || host.endsWith('.tmall.com') || host === 'tmall.com' || host === 'tmall.hk') return 'tmall';
  if (host === 'mobile.yangkeduo.com' || host.endsWith('.yangkeduo.com')) return 'pdd';
  if (host === 'mobile.pinduoduo.com' || host.endsWith('.pinduoduo.com') || host === 'pinduoduo.com') return 'pdd';
  return '';
}

function isPddGoodsPage(pathname) {
  return /^\/goods(\d+)?\.html$/.test(pathname || '');
}

function parseJdFromUrl(urlObj) {
  const path = urlObj.pathname;
  const pathMatch = path.match(/\/(\d+)\.html$/);
  if (pathMatch) return { platform: 'jd', itemId: pathMatch[1], skuId: pathMatch[1] };
  const productMatch = path.match(/\/product\/(\d+)\.html/);
  if (productMatch) return { platform: 'jd', itemId: productMatch[1], skuId: productMatch[1] };
  const sku = urlObj.searchParams.get('sku') || urlObj.searchParams.get('skuId') || urlObj.searchParams.get('wareId');
  if (sku) return { platform: 'jd', itemId: sku, skuId: sku };
  return null;
}

function parseTaobaoFromUrl(urlObj) {
  const id = urlObj.searchParams.get('id') ||
    urlObj.searchParams.get('itemId') ||
    urlObj.searchParams.get('item_id');
  if (!id) return null;
  const platform = urlObj.hostname.toLowerCase().includes('tmall') ? 'tmall' : 'taobao';
  return {
    platform,
    itemId: id,
    skuId: urlObj.searchParams.get('skuId') || urlObj.searchParams.get('sku_id') || ''
  };
}

function parsePddFromUrl(urlObj) {
  const goodsId = urlObj.searchParams.get('goods_id') || urlObj.searchParams.get('goodsId');
  if (goodsId) return { platform: 'pdd', itemId: goodsId, skuId: '' };
  return null;
}

function parseLongUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    if (host === 'item.jd.com' || host.endsWith('.jd.com') || host === 'jd.com') {
      const result = parseJdFromUrl(url);
      if (result) {
        result.canonicalUrl = `https://item.jd.com/${result.itemId}.html`;
        result.rawUrl = urlString;
        return result;
      }
    }
    if (host === 'item.taobao.com' || host.endsWith('.taobao.com') || host === 'taobao.com') {
      const result = parseTaobaoFromUrl(url);
      if (result) {
        result.canonicalUrl = `https://item.taobao.com/item.htm?id=${result.itemId}`;
        result.rawUrl = urlString;
        return result;
      }
    }
    if (host === 'detail.tmall.com' || host.endsWith('.tmall.com') || host === 'tmall.com' || host === 'tmall.hk') {
      const result = parseTaobaoFromUrl(url);
      if (result) {
        result.platform = 'tmall';
        result.canonicalUrl = `https://detail.tmall.com/item.htm?id=${result.itemId}`;
        result.rawUrl = urlString;
        return result;
      }
    }
    if (host === 'mobile.yangkeduo.com' || host.endsWith('.yangkeduo.com') ||
        host === 'mobile.pinduoduo.com' || host.endsWith('.pinduoduo.com')) {
      const result = parsePddFromUrl(url);
      if (result) {
        result.canonicalUrl = `https://mobile.yangkeduo.com/goods.html?goods_id=${result.itemId}`;
        result.rawUrl = urlString;
        return result;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function resolveHttpUrl(target, baseUrl) {
  try {
    const resolved = new URL(target, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : '';
  } catch {
    return '';
  }
}

async function readBoundedText(response, maxBytes) {
  const contentLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error('Response body is too large.');
    error.code = 'response_too_large';
    throw error;
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      const error = new Error('Response body is too large.');
      error.code = 'response_too_large';
      throw error;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function followShortLink(urlString, fetchImpl, timeoutMs = FETCH_TIMEOUT_MS) {
  let currentUrl = urlString;
  let platform = '';
  const visited = new Set();

  for (let i = 0; i < MAX_REDIRECT_DEPTH; i++) {
    if (visited.has(currentUrl)) break;
    visited.add(currentUrl);

    let urlObj;
    try {
      urlObj = new URL(currentUrl);
    } catch {
      return { ok: false, code: 'invalid_url', message: 'Invalid URL.' };
    }

    const host = urlObj.hostname.toLowerCase();
    platform = platform || platformFromHost(host);

    const parsed = parseLongUrl(currentUrl);
    if (parsed) {
      return {
        ok: true,
        data: {
          platform: parsed.platform,
          itemId: parsed.itemId,
          skuId: parsed.skuId || '',
          shopId: '',
          canonicalUrl: parsed.canonicalUrl,
          rawUrl: currentUrl,
          resolved: true
        }
      };
    }

    const isShort = Object.keys(SHORT_LINK_HOSTS).some(
      (shortHost) => host === shortHost || host.endsWith('.' + shortHost)
    );
    const isPddShort = (host === 'mobile.yangkeduo.com' || host.endsWith('.yangkeduo.com') ||
                        host === 'pinduoduo.com' || host.endsWith('.pinduoduo.com')) &&
                        !isPddGoodsPage(urlObj.pathname);
    if (!isShort && !isPddShort) break;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      });
      const location = response.headers.get('Location');
      if (location) {
        const nextUrl = resolveHttpUrl(location, currentUrl);
        if (!nextUrl) break;
        currentUrl = nextUrl;
        continue;
      }

      if (response.ok && response.status < 400) {
        const text = await readBoundedText(response, MAX_SHORT_LINK_HTML_BYTES);
        const metaMatch = text.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)/i);
        if (metaMatch) {
          const nextUrl = resolveHttpUrl(metaMatch[1].trim(), currentUrl);
          if (nextUrl) {
            currentUrl = nextUrl;
            continue;
          }
        }
        const jsMatch = text.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
        if (jsMatch) {
          const nextUrl = resolveHttpUrl(jsMatch[1], currentUrl);
          if (nextUrl) {
            currentUrl = nextUrl;
            continue;
          }
        }
      }
      break;
    } catch (error) {
      if (error.name === 'AbortError') {
        return { ok: false, code: 'timeout', message: 'Short link resolution timed out.', retryable: true };
      }
      if (error.code === 'response_too_large') {
        return { ok: false, code: error.code, message: error.message, retryable: true };
      }
      break;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const finalPlatform = platform || platformFromHost((() => {
    try { return new URL(currentUrl).hostname; } catch { return ''; }
  })());

  return {
    ok: true,
    data: {
      platform: finalPlatform || '',
      itemId: '',
      skuId: '',
      shopId: '',
      canonicalUrl: '',
      rawUrl: urlString,
      resolved: false
    }
  };
}

function createKvRepository(kv) {
  return {
    async getProduct(platform, itemId) {
      try {
        const value = await kv.get(productKey(platform, itemId), 'json');
        return value || null;
      } catch {
        return null;
      }
    },
    async putProduct(platform, itemId, data) {
      try {
        await kv.put(productKey(platform, itemId), JSON.stringify(data), {
          expirationTtl: 30 * 24 * 3600
        });
        return true;
      } catch {
        return false;
      }
    },
    async getSnapshots(platform, itemId) {
      try {
        const value = await kv.get(snapshotsKey(platform, itemId), 'json');
        return Array.isArray(value) ? value : [];
      } catch {
        return [];
      }
    },
    async addSnapshot(platform, itemId, snapshot) {
      try {
        const existing = await this.getSnapshots(platform, itemId);
        const cutoff = new Date(snapshot.capturedAt).getTime() - MAX_SNAPSHOT_AGE_MS;
        const filtered = existing.filter((s) => new Date(s.capturedAt).getTime() >= cutoff);
        filtered.push(snapshot);
        filtered.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
        const limited = filtered.slice(-MAX_SNAPSHOTS_PER_PRODUCT);
        await kv.put(snapshotsKey(platform, itemId), JSON.stringify(limited), {
          expirationTtl: 365 * 24 * 3600
        });
        return { ok: true, snapshots: limited };
      } catch {
        return { ok: false, snapshots: [] };
      }
    }
  };
}

function isDuplicateSnapshot(snapshots, price, capturedAt) {
  const capturedAtMs = new Date(capturedAt).getTime();
  const priceInCents = Math.round(price * 100);
  return (snapshots || []).some((snapshot) => {
    const ageMs = capturedAtMs - new Date(snapshot.capturedAt).getTime();
    return ageMs >= 0 && ageMs <= SNAPSHOT_DEDUP_WINDOW_MS &&
      Math.round(Number(snapshot.finalPrice) * 100) === priceInCents;
  });
}

async function applySnapshotRateLimits(request, input, env, origin) {
  const clientLimiter = env?.SNAPSHOT_CLIENT_LIMITER;
  const itemLimiter = env?.SNAPSHOT_ITEM_LIMITER;
  if (!clientLimiter?.limit || !itemLimiter?.limit) {
    return errorResponse('rate_limit_unavailable', 'Snapshot rate limiting is unavailable.', 503, origin, env, true);
  }

  const clientId = request.headers.get('X-Price-Client-ID') || '';
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return errorResponse('missing_client_id', 'A valid anonymous client ID is required.', 400, origin, env);
  }

  const clientResult = await clientLimiter.limit({ key: `snapshot:${clientId}` });
  if (!clientResult?.success) {
    return errorResponse('rate_limited', 'Too many snapshot requests.', 429, origin, env, true);
  }

  const itemResult = await itemLimiter.limit({ key: `snapshot:${input.platform}:${input.itemId}` });
  if (!itemResult?.success) {
    return errorResponse('rate_limited', 'Too many snapshots for this item.', 429, origin, env, true);
  }

  return null;
}

export function createPriceApp({
  kv,
  fetchImpl = fetch,
  now = () => new Date(),
  shortLinkTimeoutMs = FETCH_TIMEOUT_MS
}) {
  const repository = createKvRepository(kv);

  async function handleResolve(request, origin, env) {
    const body = await readJson(request);
    if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);

    const input = body.value;
    if (!isObject(input) || !hasOnlyKeys(input, ['url', 'text'])) {
      return errorResponse('invalid_body', 'Request body must contain url or text field.', 400, origin, env);
    }

    const url = input.url || extractFirstUrl(input.text || '');
    if (!url) {
      const title = extractProductTitle(input.text || '');
      const textPlatform = detectPlatformFromText(input.text || '');
      if (textPlatform && title) {
        return json({
          platform: textPlatform,
          itemId: '',
          skuId: '',
          title,
          rawUrl: '',
          canonicalUrl: '',
          resolved: false,
          source: 'text_extract',
          notice: `已识别${normalizePlatformLabel(textPlatform)}商品，短链版无法自动获取价格，请先手动记录当前价格。`
        }, 200, origin, env);
      }
      return errorResponse('missing_url', 'No URL found in input.', 400, origin, env);
    }

    const textTitle = extractProductTitle(input.text || '');
    const textPlatform = detectPlatformFromText(input.text || '');

    const longParsed = parseLongUrl(url);
    if (longParsed) {
      const cached = await repository.getProduct(longParsed.platform, longParsed.itemId);
      return json({
        platform: longParsed.platform,
        itemId: longParsed.itemId,
        skuId: longParsed.skuId || '',
        shopId: longParsed.shopId || '',
        title: textTitle || cached?.title || '',
        rawUrl: url,
        canonicalUrl: longParsed.canonicalUrl,
        resolved: true,
        source: 'parsed',
        currentPrice: cached?.currentPrice || null,
        lastUpdatedAt: cached?.lastUpdatedAt || null
      }, 200, origin, env);
    }

    const result = await followShortLink(url, fetchImpl, shortLinkTimeoutMs);
    if (!result.ok) {
      if (textPlatform) {
        return json({
          platform: textPlatform,
          itemId: '',
          skuId: '',
          title: textTitle || '',
          rawUrl: url,
          canonicalUrl: '',
          resolved: false,
          source: 'short_link_unresolved',
          notice: `已识别${normalizePlatformLabel(textPlatform)}商品，但无法自动展开短链，请先手动记录当前价格。`
        }, 200, origin, env);
      }
      return errorResponse(result.code, result.message, 502, origin, env, result.retryable);
    }

    const data = result.data;
    const platform = data.platform || textPlatform || '';

    if (!data.resolved || !data.itemId) {
      return json({
        platform,
        itemId: '',
        skuId: '',
        title: textTitle || '',
        rawUrl: url,
        canonicalUrl: data.canonicalUrl || '',
        resolved: false,
        source: 'short_link_unresolved',
        notice: platform
          ? `已识别${normalizePlatformLabel(platform)}商品，但无法自动展开短链，请先手动记录当前价格。`
          : '已识别商品，但无法自动展开短链，请先手动记录当前价格。'
      }, 200, origin, env);
    }

    const cached = await repository.getProduct(platform, data.itemId);
    return json({
      platform,
      itemId: data.itemId,
      skuId: data.skuId || '',
      shopId: '',
      title: textTitle || cached?.title || '',
      rawUrl: url,
      canonicalUrl: data.canonicalUrl,
      resolved: true,
      source: 'short_link_resolved',
      currentPrice: cached?.currentPrice || null,
      lastUpdatedAt: cached?.lastUpdatedAt || null
    }, 200, origin, env);
  }

  async function handleRecordPrice(request, origin, env) {
    const body = await readJson(request);
    if (!body.ok) return errorResponse(body.code, body.message, body.status, origin, env);

    const input = body.value;
    if (!isObject(input) || !hasOnlyKeys(input, ['platform', 'itemId', 'finalPrice', 'listPrice', 'promoPrice', 'couponPrice', 'stockStatus', 'title'])) {
      return errorResponse('invalid_body', 'Invalid request body.', 400, origin, env);
    }

    if (!isValidPlatform(input.platform)) {
      return errorResponse('invalid_platform', 'Invalid platform.', 400, origin, env);
    }
    if (!isValidItemId(input.itemId)) {
      return errorResponse('invalid_item_id', 'Invalid item ID.', 400, origin, env);
    }
    if (!isValidPrice(input.finalPrice)) {
      return errorResponse('invalid_price', 'Invalid final price.', 400, origin, env);
    }

    for (const field of ['listPrice', 'promoPrice', 'couponPrice']) {
      if (input[field] != null && !isValidPrice(input[field])) {
        return errorResponse('invalid_price', `Invalid ${field}.`, 400, origin, env);
      }
    }

    const rateLimitResponse = await applySnapshotRateLimits(request, input, env, origin);
    if (rateLimitResponse) return rateLimitResponse;

    const existing = await repository.getSnapshots(input.platform, input.itemId);
    const capturedAt = now().toISOString();
    if (isDuplicateSnapshot(existing, input.finalPrice, capturedAt)) {
      return json({
        platform: input.platform,
        itemId: input.itemId,
        snapshotCount: existing.length,
        latestPrice: input.finalPrice,
        capturedAt,
        deduplicated: true
      }, 200, origin, env);
    }

    if (isSuspiciousPrice(input.finalPrice, existing)) {
      return errorResponse('suspicious_price', 'Price differs too much from recent shared history.', 422, origin, env);
    }

    const snapshot = {
      finalPrice: input.finalPrice,
      listPrice: typeof input.listPrice === 'number' ? input.listPrice : input.finalPrice,
      promoPrice: typeof input.promoPrice === 'number' ? input.promoPrice : null,
      couponPrice: typeof input.couponPrice === 'number' ? input.couponPrice : null,
      stockStatus: typeof input.stockStatus === 'string' ? input.stockStatus : 'unknown',
      capturedAt
    };

    const writeResult = await repository.addSnapshot(input.platform, input.itemId, snapshot);
    if (!writeResult.ok) {
      return errorResponse('storage_unavailable', 'Shared history storage is unavailable.', 503, origin, env, true);
    }

    if (input.title) {
      await repository.putProduct(input.platform, input.itemId, {
        platform: input.platform,
        itemId: input.itemId,
        title: normalizeTitle(input.title),
        currentPrice: input.finalPrice,
        lastUpdatedAt: capturedAt
      });
    }

    return json({
      platform: input.platform,
      itemId: input.itemId,
      snapshotCount: writeResult.snapshots.length,
      latestPrice: snapshot.finalPrice,
      capturedAt,
      deduplicated: false
    }, 200, origin, env);
  }

  async function handleHistory(request, env, origin) {
    const url = new URL(request.url);
    const platform = url.searchParams.get('platform');
    const itemId = url.searchParams.get('item_id');

    if (!isValidPlatform(platform)) {
      return errorResponse('invalid_platform', 'Invalid platform.', 400, origin, env);
    }
    if (!isValidItemId(itemId)) {
      return errorResponse('invalid_item_id', 'Invalid item ID.', 400, origin, env);
    }

    const snapshots = await repository.getSnapshots(platform, itemId);
    return json({
      platform,
      itemId,
      snapshotCount: snapshots.length,
      snapshots
    }, 200, origin, env);
  }

  async function handleConfig(origin, env) {
    return json({
      version: '1.0.0',
      features: {
        shortLinkResolve: true,
        priceHistory: true
      }
    }, 200, origin, env);
  }

  async function fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      return optionsResponse(origin, env);
    }
    if (!origin) {
      return errorResponse('forbidden', 'Origin not allowed.', 403, origin || '*', env);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/price/, '');

    if (path === '/config' && request.method === 'GET') {
      return handleConfig(origin, env);
    }
    if (path === '/resolve' && request.method === 'POST') {
      return handleResolve(request, origin, env);
    }
    if (path === '/snapshot' && request.method === 'POST') {
      return handleRecordPrice(request, origin, env);
    }
    if (path === '/history' && request.method === 'GET') {
      return handleHistory(request, env, origin);
    }

    return errorResponse('not_found', 'Not found.', 404, origin, env);
  }

  return { fetch };
}
