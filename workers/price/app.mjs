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
const PRICE_CACHE_TTL_SECONDS = 6 * 3600;

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

async function followShortLink(urlString, env) {
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
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
        }
      });
      clearTimeout(timeoutId);

      const location = response.headers.get('Location');
      if (location) {
        let nextUrl = location;
        if (nextUrl.startsWith('/')) {
          nextUrl = urlObj.origin + nextUrl;
        }
        if (!/^https?:\/\//i.test(nextUrl)) {
          break;
        }
        currentUrl = nextUrl;
        continue;
      }

      if (response.ok && response.status < 400) {
        const text = await response.text().catch(() => '');
        const metaMatch = text.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)/i);
        if (metaMatch) {
          let nextUrl = metaMatch[1].trim();
          if (nextUrl.startsWith('/')) {
            nextUrl = urlObj.origin + nextUrl;
          }
          if (/^https?:\/\//i.test(nextUrl)) {
            currentUrl = nextUrl;
            continue;
          }
        }
        const jsMatch = text.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
        if (jsMatch && /^https?:\/\//i.test(jsMatch[1])) {
          currentUrl = jsMatch[1];
          continue;
        }
      }
      break;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return { ok: false, code: 'timeout', message: 'Short link resolution timed out.', retryable: true };
      }
      break;
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
      } catch {
        // best effort
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
        const cutoff = Date.now() - MAX_SNAPSHOT_AGE_MS;
        const filtered = existing.filter((s) => new Date(s.capturedAt).getTime() >= cutoff);
        filtered.push(snapshot);
        filtered.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
        await kv.put(snapshotsKey(platform, itemId), JSON.stringify(filtered), {
          expirationTtl: 365 * 24 * 3600
        });
        return filtered;
      } catch {
        return [];
      }
    }
  };
}

export function createPriceApp({ kv }) {
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

    const result = await followShortLink(url, env);
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
    if (!isObject(input) || !hasOnlyKeys(input, ['platform', 'itemId', 'finalPrice', 'listPrice', 'promoPrice', 'couponPrice', 'note', 'stockStatus', 'capturedAt', 'title'])) {
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

    const capturedAt = input.capturedAt || new Date().toISOString();
    const snapshot = {
      finalPrice: input.finalPrice,
      listPrice: typeof input.listPrice === 'number' ? input.listPrice : input.finalPrice,
      promoPrice: typeof input.promoPrice === 'number' ? input.promoPrice : null,
      couponPrice: typeof input.couponPrice === 'number' ? input.couponPrice : null,
      note: typeof input.note === 'string' ? input.note : '',
      stockStatus: typeof input.stockStatus === 'string' ? input.stockStatus : 'in_stock',
      capturedAt
    };

    const snapshots = await repository.addSnapshot(input.platform, input.itemId, snapshot);

    if (input.title) {
      await repository.putProduct(input.platform, input.itemId, {
        platform: input.platform,
        itemId: input.itemId,
        title: input.title,
        currentPrice: input.finalPrice,
        lastUpdatedAt: capturedAt
      });
    }

    return json({
      platform: input.platform,
      itemId: input.itemId,
      snapshotCount: snapshots.length,
      latestPrice: snapshot.finalPrice,
      capturedAt
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
