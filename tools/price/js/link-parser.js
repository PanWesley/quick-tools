(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaLinkParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var SHORT_LINK_CONFIG = {
    '3.cn': { platform: 'jd', name: '京东短链' },
    'u.jd.com': { platform: 'jd', name: '京东短链' },
    'jd.cn': { platform: 'jd', name: '京东短链' },
    'm.tb.cn': { platform: 'taobao', name: '淘宝短链' },
    'e.tb.cn': { platform: 'taobao', name: '淘宝短链' },
    'tb.cn': { platform: 'taobao', name: '淘宝短链' },
    's.click.taobao.com': { platform: 'taobao', name: '淘宝推广短链' },
    'p.pinduoduo.com': { platform: 'pdd', name: '拼多多短链' },
    'pinduoduo.com': { platform: 'pdd', name: '拼多多短链' },
    'yangkeduo.com': { platform: 'pdd', name: '拼多多链接' }
  };

  var PLATFORM_GUIDES = {
    jd: [
      '1. 打开京东 APP，进入商品详情页',
      '2. 点击右上角「分享」按钮',
      '3. 选择「复制链接」，粘贴到上方输入框'
    ],
    taobao: [
      '1. 打开淘宝 APP，进入商品详情页',
      '2. 点击右上角「分享」按钮',
      '3. 选择「复制链接」，粘贴到上方输入框'
    ],
    tmall: [
      '1. 打开天猫/淘宝 APP，进入商品详情页',
      '2. 点击右上角「分享」按钮',
      '3. 选择「复制链接」，粘贴到上方输入框'
    ],
    pdd: [
      '1. 打开拼多多 APP，进入商品详情页',
      '2. 点击右上角「分享」按钮',
      '3. 选择「复制链接」，粘贴到上方输入框'
    ]
  };

  function stripTrailingPunctuation(url) {
    var cleaned = String(url || '');
    while (/[.,;!?，。；、)）\]】」』]$/.test(cleaned)) {
      cleaned = cleaned.slice(0, -1);
    }
    return cleaned;
  }

  function extractFirstUrl(input) {
    var text = String(input || '').trim();
    var match = text.match(/https?:\/\/[^\s"'<>「」『』【】]+/i);
    return match ? stripTrailingPunctuation(match[0]) : '';
  }

  function extractProductTitle(input) {
    var text = String(input || '');
    var cornerMatch = text.match(/「([^」]+)」/);
    if (cornerMatch && cornerMatch[1]) {
      return cornerMatch[1].trim();
    }
    var doubleQuoteMatch = text.match(/"([^"]{4,80})"/);
    if (doubleQuoteMatch && doubleQuoteMatch[1]) {
      return doubleQuoteMatch[1].trim();
    }
    return '';
  }

  function detectPlatformFromText(input) {
    var text = String(input || '');
    if (/【京东】|京东\s*(APP|速购|超市)/.test(text)) return 'jd';
    if (/【淘宝】|淘宝\s*(APP|特价)/.test(text)) return 'taobao';
    if (/【天猫】|天猫/.test(text)) return 'tmall';
    if (/【拼多多】|拼多多|拼夕夕/.test(text)) return 'pdd';
    if (/￥[A-Za-z0-9]{8,}￥/.test(text)) return 'taobao';
    return '';
  }

  function hasTaoKouLing(input) {
    return /￥[A-Za-z0-9]{8,}￥/.test(String(input || ''));
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

  function fail(code, message, extra) {
    var result = { ok: false, error: { code: code, message: message } };
    if (extra) {
      Object.keys(extra).forEach(function(key) {
        result.error[key] = extra[key];
      });
    }
    return result;
  }

  function isShortLinkHost(hostname, pathname) {
    var host = hostname.toLowerCase();
    var path = pathname || '';
    if ((host === 'mobile.yangkeduo.com' || host === 'yangkeduo.com' || host.endsWith('.yangkeduo.com')) &&
        (path.indexOf('/goods') === 0 || path.indexOf('/goods.html') === 0 || path.indexOf('/goods2.html') === 0)) {
      return false;
    }
    if ((host === 'pinduoduo.com' || host === 'mobile.pinduoduo.com' || host.endsWith('.pinduoduo.com')) &&
        (path.indexOf('/goods') === 0 || path.indexOf('/goods.html') === 0)) {
      return false;
    }
    return Object.keys(SHORT_LINK_CONFIG).some(function(shortHost) {
      return host === shortHost || host.endsWith('.' + shortHost);
    });
  }

  function getShortLinkInfo(hostname, pathname) {
    if (!isShortLinkHost(hostname, pathname)) return null;
    var host = hostname.toLowerCase();
    var hosts = Object.keys(SHORT_LINK_CONFIG);
    for (var i = 0; i < hosts.length; i++) {
      var shortHost = hosts[i];
      if (host === shortHost || host.endsWith('.' + shortHost)) {
        return SHORT_LINK_CONFIG[shortHost];
      }
    }
    return null;
  }

  function normalizeHost(parsed) {
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^h5\./, '');
  }

  function parseJd(parsed, rawUrl) {
    var skuId = '';
    var pathMatch = parsed.pathname.match(/\/(\d+)\.html$/);
    if (pathMatch) {
      skuId = pathMatch[1];
    } else {
      var productMatch = parsed.pathname.match(/\/product\/(\d+)\.html/);
      if (productMatch) {
        skuId = productMatch[1];
      } else {
        skuId = parsed.searchParams.get('sku') || parsed.searchParams.get('skuId') || parsed.searchParams.get('wareId');
      }
    }
    if (!skuId) return fail('parse_failed', '没有识别到京东商品 ID。');
    return ok({
      platform: 'jd',
      itemId: skuId,
      skuId: skuId,
      shopId: parsed.searchParams.get('shopId') || parsed.searchParams.get('shop_id') || '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://item.jd.com/' + encodeURIComponent(skuId) + '.html'
    });
  }

  function parseTaobaoLike(parsed, rawUrl, platform) {
    var itemId = parsed.searchParams.get('id') ||
      parsed.searchParams.get('itemId') ||
      parsed.searchParams.get('item_id');
    if (!itemId) return fail('parse_failed', '没有识别到商品 ID。');
    var host = platform === 'tmall' ? 'detail.tmall.com' : 'item.taobao.com';
    return ok({
      platform: platform,
      itemId: itemId,
      skuId: parsed.searchParams.get('skuId') || parsed.searchParams.get('sku_id') || '',
      shopId: parsed.searchParams.get('shop_id') || parsed.searchParams.get('shopId') || '',
      rawUrl: rawUrl,
      canonicalUrl: 'https://' + host + '/item.htm?id=' + encodeURIComponent(itemId)
    });
  }

  function parsePdd(parsed, rawUrl) {
    var itemId = parsed.searchParams.get('goods_id') ||
      parsed.searchParams.get('goodsId') ||
      parsed.searchParams.get('goods_sign') ||
      parsed.searchParams.get('ps');
    var isShortSign = !parsed.searchParams.get('goods_id') && !parsed.searchParams.get('goodsId');
    if (itemId && !isShortSign) {
      return ok({
        platform: 'pdd',
        itemId: itemId,
        skuId: parsed.searchParams.get('sku_id') || parsed.searchParams.get('skuId') || '',
        shopId: '',
        rawUrl: rawUrl,
        canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=' + encodeURIComponent(itemId)
      });
    }
    if (itemId && isShortSign) {
      return fail('pdd_sign_unsupported', '识别到拼多多链接，但这是微信/短链格式，需要复制商品详情页完整链接。', {
        platform: 'pdd',
        isPddSign: true
      });
    }
    var pathMatch = parsed.pathname.match(/\/goods(?:2)?\.html/);
    if (pathMatch && parsed.searchParams.toString()) {
      return fail('pdd_sign_unsupported', '识别到拼多多链接，但需要完整商品详情链接。', {
        platform: 'pdd',
        isPddSign: true
      });
    }
    return fail('parse_failed', '没有识别到拼多多商品 ID。');
  }

  function buildShortLinkResult(hostname, input) {
    var info = getShortLinkInfo(hostname, '/');
    var platform = (info && info.platform) || detectPlatformFromText(input) || 'unknown';
    var title = extractProductTitle(input);
    var hostLabel = info ? info.name : '短链接';
    var platformLabel = platform ? normalizePlatformLabel(platform) : '';
    var itemId = '';
    if (title) {
      var hash = 0;
      for (var i = 0; i < title.length; i++) {
        hash = ((hash << 5) - hash) + title.charCodeAt(i);
        hash |= 0;
      }
      itemId = 'short_' + platform + '_' + Math.abs(hash).toString(36);
    } else {
      itemId = 'short_' + platform + '_' + Date.now().toString(36);
    }

    return {
      ok: true,
      data: {
        platform: platform,
        itemId: itemId,
        skuId: '',
        shopId: '',
        title: title || (platformLabel + '商品'),
        rawUrl: extractFirstUrl(input),
        canonicalUrl: extractFirstUrl(input),
        source: 'short_link',
        isShortLink: true,
        extractedTitle: title,
        shortHost: hostname,
        notice: platformLabel
          ? '已识别' + platformLabel + '商品，短链版无法自动获取价格，请先手动记录当前价格。'
          : '已识别商品，短链版无法自动获取价格，请先手动记录当前价格。'
      }
    };
  }

  function buildTaoKouLingResult(input) {
    var title = extractProductTitle(input);
    var itemId = 'tkl_' + Date.now().toString(36);
    return {
      ok: true,
      data: {
        platform: 'taobao',
        itemId: itemId,
        skuId: '',
        shopId: '',
        title: title || '淘宝商品',
        rawUrl: '',
        canonicalUrl: '',
        source: 'tao_kouling',
        isShortLink: true,
        isTaoKouLing: true,
        extractedTitle: title,
        notice: '已识别淘宝淘口令商品，请先手动记录当前价格。'
      }
    };
  }

  function buildPddSignResult(parsed, rawUrl, input) {
    var title = extractProductTitle(input);
    var ps = parsed.searchParams.get('ps') || parsed.searchParams.get('goods_sign') || '';
    var itemId = ps ? ('pdd_sign_' + ps) : ('pdd_short_' + Date.now().toString(36));
    return {
      ok: true,
      data: {
        platform: 'pdd',
        itemId: itemId,
        skuId: '',
        shopId: '',
        title: title || '拼多多商品',
        rawUrl: rawUrl,
        canonicalUrl: rawUrl,
        source: 'pdd_short',
        isShortLink: true,
        isPddSign: true,
        extractedTitle: title,
        notice: '已识别拼多多商品，微信/短链版无法自动获取价格，请先手动记录当前价格。'
      }
    };
  }

  function parseProductInput(input) {
    var rawUrl = extractFirstUrl(input);
    var extractedTitle = extractProductTitle(input);
    var textPlatform = detectPlatformFromText(input);
    var hasTkl = hasTaoKouLing(input);

    if (!rawUrl) {
      if (hasTkl) {
        return buildTaoKouLingResult(input);
      }
      if (textPlatform && extractedTitle) {
        var hash = 0;
        for (var i = 0; i < extractedTitle.length; i++) {
          hash = ((hash << 5) - hash) + extractedTitle.charCodeAt(i);
          hash |= 0;
        }
        return ok({
          platform: textPlatform,
          itemId: 'text_' + textPlatform + '_' + Math.abs(hash).toString(36),
          skuId: '',
          shopId: '',
          title: extractedTitle,
          rawUrl: '',
          canonicalUrl: '',
          source: 'text_only',
          isShortLink: true,
          extractedTitle: extractedTitle,
          notice: '已识别' + normalizePlatformLabel(textPlatform) + '商品，请先手动记录当前价格。'
        });
      }
      return fail('missing_url', '没有识别到商品链接。');
    }

    var parsed;
    try {
      parsed = new URL(rawUrl);
      parsed.hash = '';
    } catch (error) {
      return fail('invalid_url', '链接格式无效。');
    }

    var hostname = normalizeHost(parsed);
    var originalHostname = parsed.hostname.toLowerCase();
    var originalPathname = parsed.pathname;

    if (isShortLinkHost(originalHostname, originalPathname)) {
      var result = buildShortLinkResult(originalHostname, input);
      return result;
    }

    var result;
    if (hostname === 'item.jd.com' || hostname.endsWith('.jd.com') || hostname === 'jd.com') {
      result = parseJd(parsed, rawUrl);
    } else if (hostname === 'item.taobao.com' || hostname.endsWith('.taobao.com') || hostname === 'taobao.com') {
      result = parseTaobaoLike(parsed, rawUrl, 'taobao');
    } else if (hostname === 'detail.tmall.com' || hostname.endsWith('.tmall.com') || hostname === 'tmall.com' || hostname === 'tmall.hk') {
      result = parseTaobaoLike(parsed, rawUrl, 'tmall');
    } else if (hostname === 'mobile.yangkeduo.com' || hostname === 'yangkeduo.com' || hostname.endsWith('.yangkeduo.com')) {
      var pddResult = parsePdd(parsed, rawUrl);
      if (!pddResult.ok && pddResult.error && pddResult.error.code === 'pdd_sign_unsupported') {
        return buildPddSignResult(parsed, rawUrl, input);
      }
      result = pddResult;
    } else if (hostname === 'mobile.pinduoduo.com' || hostname === 'pinduoduo.com' || hostname.endsWith('.pinduoduo.com')) {
      var pddResult2 = parsePdd(parsed, rawUrl);
      if (!pddResult2.ok && pddResult2.error && pddResult2.error.code === 'pdd_sign_unsupported') {
        return buildPddSignResult(parsed, rawUrl, input);
      }
      result = pddResult2;
    } else {
      if (textPlatform && extractedTitle) {
        var hash2 = 0;
        for (var j = 0; j < extractedTitle.length; j++) {
          hash2 = ((hash2 << 5) - hash2) + extractedTitle.charCodeAt(j);
          hash2 |= 0;
        }
        return ok({
          platform: textPlatform,
          itemId: 'unknown_' + textPlatform + '_' + Math.abs(hash2).toString(36),
          skuId: '',
          shopId: '',
          title: extractedTitle,
          rawUrl: rawUrl,
          canonicalUrl: rawUrl,
          source: 'unknown_platform',
          isShortLink: true,
          extractedTitle: extractedTitle,
          notice: '已识别' + normalizePlatformLabel(textPlatform) + '商品，请先手动记录当前价格。'
        });
      }
      return fail('unsupported_platform', '暂不支持该平台链接。');
    }

    if (result.ok && extractedTitle) {
      result.data.extractedTitle = extractedTitle;
    }
    if (result.ok && textPlatform && !result.data.platform) {
      result.data.detectedPlatform = textPlatform;
    }
    if (!result.ok && result.error) {
      if (extractedTitle) result.error.extractedTitle = extractedTitle;
      if (textPlatform) {
        result.error.platform = result.error.platform || textPlatform;
        if (PLATFORM_GUIDES[textPlatform]) {
          result.error.guideSteps = PLATFORM_GUIDES[textPlatform];
        }
      }
    }
    return result;
  }

  return {
    extractFirstUrl: extractFirstUrl,
    extractProductTitle: extractProductTitle,
    detectPlatformFromText: detectPlatformFromText,
    normalizePlatformLabel: normalizePlatformLabel,
    parseProductInput: parseProductInput
  };
});
