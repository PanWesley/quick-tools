(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaLinkParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var SHORT_LINK_HOSTS = ['m.tb.cn', 's.click.taobao.com', 'u.jd.com', '3.cn', 'p.pinduoduo.com'];

  function stripTrailingPunctuation(url) {
    var cleaned = String(url || '');
    while (/[.,;!?，。；、)）\]]$/.test(cleaned)) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  }

  function extractFirstUrl(input) {
    var text = String(input || '').trim();
    var match = text.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? stripTrailingPunctuation(match[0]) : '';
  }

  function normalizePlatformLabel(platform) {
    return {
      jd: '京东',
      taobao: '淘宝',
      tmall: '天猫',
      pdd: '拼多多'
    }[platform] || '未知平台';
  }

  function ok(data) {
    return { ok: true, data: data };
  }

  function fail(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  function isShortLink(hostname) {
    return SHORT_LINK_HOSTS.some(function(host) {
      return hostname === host || hostname.endsWith('.' + host);
    });
  }

  function normalizeHost(parsed) {
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  }

  function parseJd(parsed, rawUrl) {
    var pathMatch = parsed.pathname.match(/\/(\d+)\.html$/);
    var skuId = pathMatch ? pathMatch[1] : parsed.searchParams.get('sku') || parsed.searchParams.get('skuId');
    if (!skuId) return fail('parse_failed', '没有识别到京东商品 ID。');
    return ok({
      platform: 'jd',
      itemId: skuId,
      skuId: skuId,
      shopId: '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://item.jd.com/' + encodeURIComponent(skuId) + '.html'
    });
  }

  function parseTaobaoLike(parsed, rawUrl, platform) {
    var itemId = parsed.searchParams.get('id') || parsed.searchParams.get('itemId');
    if (!itemId) return fail('parse_failed', '没有识别到商品 ID。');
    var host = platform === 'tmall' ? 'detail.tmall.com' : 'item.taobao.com';
    return ok({
      platform: platform,
      itemId: itemId,
      skuId: parsed.searchParams.get('skuId') || '',
      shopId: parsed.searchParams.get('shop_id') || '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://' + host + '/item.htm?id=' + encodeURIComponent(itemId)
    });
  }

  function parsePdd(parsed, rawUrl) {
    var itemId = parsed.searchParams.get('goods_id') || parsed.searchParams.get('goodsId');
    if (!itemId) return fail('parse_failed', '没有识别到拼多多商品 ID。');
    return ok({
      platform: 'pdd',
      itemId: itemId,
      skuId: parsed.searchParams.get('sku_id') || parsed.searchParams.get('skuId') || '',
      shopId: '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=' + encodeURIComponent(itemId)
    });
  }

  function parseProductInput(input) {
    var rawUrl = extractFirstUrl(input);
    if (!rawUrl) return fail('missing_url', '没有识别到商品链接。');

    var parsed;
    try {
      parsed = new URL(rawUrl);
      parsed.hash = '';
    } catch (error) {
      return fail('invalid_url', '链接格式无效。');
    }

    var hostname = normalizeHost(parsed);
    if (isShortLink(hostname)) {
      return fail('short_link_unsupported', '首版无法展开短链接，请复制完整商品详情页链接。');
    }
    if (hostname === 'item.jd.com' || hostname.endsWith('.jd.com')) return parseJd(parsed, rawUrl);
    if (hostname === 'item.taobao.com' || hostname.endsWith('.taobao.com')) return parseTaobaoLike(parsed, rawUrl, 'taobao');
    if (hostname === 'detail.tmall.com' || hostname.endsWith('.tmall.com')) return parseTaobaoLike(parsed, rawUrl, 'tmall');
    if (hostname === 'mobile.yangkeduo.com' || hostname === 'yangkeduo.com' || hostname.endsWith('.yangkeduo.com')) return parsePdd(parsed, rawUrl);
    return fail('unsupported_platform', '暂不支持该平台链接。');
  }

  return {
    extractFirstUrl: extractFirstUrl,
    normalizePlatformLabel: normalizePlatformLabel,
    parseProductInput: parseProductInput
  };
});
