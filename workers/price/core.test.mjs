import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedOrigin,
  extractFirstUrl,
  extractProductTitle,
  detectPlatformFromText,
  normalizePlatformLabel,
  isValidPlatform,
  isValidItemId,
  isValidPrice,
  normalizeTitle,
  medianPrice,
  isSuspiciousPrice,
  productKey,
  snapshotsKey,
  isObject,
  hasOnlyKeys,
  MAX_SNAPSHOT_AGE_MS
} from './core.mjs';

const mockEnv = {
  ALLOWED_ORIGINS: 'https://billnest.top,https://www.billnest.top'
};

test('allowedOrigin accepts origins from the allowlist', () => {
  const request = new Request('https://billnest.top/api/price/config', {
    headers: { Origin: 'https://billnest.top' }
  });
  assert.equal(allowedOrigin(request, mockEnv), 'https://billnest.top');
});

test('allowedOrigin rejects unknown origins', () => {
  const request = new Request('https://billnest.top/api/price/config', {
    headers: { Origin: 'https://evil.com' }
  });
  assert.equal(allowedOrigin(request, mockEnv), null);
});

test('allowedOrigin fails closed when env is missing', () => {
  const request = new Request('https://billnest.top/api/price/config', {
    headers: { Origin: 'https://billnest.top' }
  });
  assert.equal(allowedOrigin(request, {}), null);
});

test('allowedOrigin supports explicit wildcard configuration', () => {
  const request = new Request('https://billnest.top/api/price/config', {
    headers: { Origin: 'https://example.com' }
  });
  assert.equal(allowedOrigin(request, { ALLOWED_ORIGINS: '*' }), '*');
});

test('allowedOrigin uses request URL for same-origin requests without Origin', () => {
  const request = new Request('https://billnest.top/api/price/config');
  assert.equal(allowedOrigin(request, mockEnv), 'https://billnest.top');
});

test('extractFirstUrl finds the first URL in text', () => {
  const url = extractFirstUrl('【京东】https://3.cn/abc 看看这个');
  assert.equal(url, 'https://3.cn/abc');
});

test('extractFirstUrl strips trailing punctuation', () => {
  assert.equal(extractFirstUrl('看看 https://item.jd.com/123.html.'), 'https://item.jd.com/123.html');
  assert.equal(extractFirstUrl('看看 https://item.jd.com/123.html，'), 'https://item.jd.com/123.html');
});

test('extractFirstUrl returns empty for no URL', () => {
  assert.equal(extractFirstUrl('只是一些文字'), '');
});

test('extractProductTitle extracts from corner brackets', () => {
  assert.equal(extractProductTitle('...「初申针织女薄款内外搭外套」...'), '初申针织女薄款内外搭外套');
});

test('extractProductTitle returns empty when none found', () => {
  assert.equal(extractProductTitle('没有标题的文字'), '');
});

test('detectPlatformFromText detects platforms from tags', () => {
  assert.equal(detectPlatformFromText('【京东】xxx'), 'jd');
  assert.equal(detectPlatformFromText('【淘宝】xxx'), 'taobao');
  assert.equal(detectPlatformFromText('【天猫】xxx'), 'tmall');
  assert.equal(detectPlatformFromText('【拼多多】xxx'), 'pdd');
});

test('detectPlatformFromText detects taobao from tao kou ling', () => {
  assert.equal(detectPlatformFromText('￥abcdefgh12￥'), 'taobao');
});

test('normalizePlatformLabel returns Chinese labels', () => {
  assert.equal(normalizePlatformLabel('jd'), '京东');
  assert.equal(normalizePlatformLabel('taobao'), '淘宝');
  assert.equal(normalizePlatformLabel('tmall'), '天猫');
  assert.equal(normalizePlatformLabel('pdd'), '拼多多');
  assert.equal(normalizePlatformLabel('unknown'), '未知平台');
});

test('isValidPlatform validates platform codes', () => {
  assert.equal(isValidPlatform('jd'), true);
  assert.equal(isValidPlatform('taobao'), true);
  assert.equal(isValidPlatform('tmall'), true);
  assert.equal(isValidPlatform('pdd'), true);
  assert.equal(isValidPlatform('xxx'), false);
  assert.equal(isValidPlatform(''), false);
});

test('isValidItemId validates item ids', () => {
  assert.equal(isValidItemId('100012043978'), true);
  assert.equal(isValidItemId('short_jd_abc'), true);
  assert.equal(isValidItemId(''), false);
  assert.equal(isValidItemId(null), false);
});

test('isValidPrice validates price values', () => {
  assert.equal(isValidPrice(99.9), true);
  assert.equal(isValidPrice(0), false);
  assert.equal(isValidPrice(1000000), true);
  assert.equal(isValidPrice(-10), false);
  assert.equal(isValidPrice(NaN), false);
  assert.equal(isValidPrice('abc'), false);
  assert.equal(isValidPrice(1000001), false);
});

test('normalizeTitle collapses whitespace and enforces the maximum length', () => {
  assert.equal(normalizeTitle('  商品   标题\n 测试  '), '商品 标题 测试');
  assert.equal(normalizeTitle('x'.repeat(205)).length, 200);
  assert.equal(normalizeTitle(null), '');
});

test('medianPrice calculates the median from valid snapshots', () => {
  assert.equal(medianPrice([{ finalPrice: 30 }, { finalPrice: 10 }, { finalPrice: 20 }]), 20);
  assert.equal(medianPrice([{ finalPrice: 10 }, { finalPrice: 20 }]), 15);
  assert.equal(medianPrice([{ finalPrice: 0 }, { finalPrice: 'invalid' }]), 0);
});

test('isSuspiciousPrice rejects extreme outliers after five snapshots', () => {
  const snapshots = [90, 95, 100, 105, 110].map((finalPrice) => ({ finalPrice }));
  assert.equal(isSuspiciousPrice(24, snapshots), true);
  assert.equal(isSuspiciousPrice(401, snapshots), true);
  assert.equal(isSuspiciousPrice(25, snapshots), false);
  assert.equal(isSuspiciousPrice(400, snapshots), false);
  assert.equal(isSuspiciousPrice(1000, snapshots.slice(0, 4)), false);
});

test('productKey and snapshotsKey format correctly', () => {
  assert.equal(productKey('jd', '123'), 'product:jd:123');
  assert.equal(snapshotsKey('taobao', '456'), 'snapshots:taobao:456');
});

test('isObject checks plain objects', () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject({ a: 1 }), true);
  assert.equal(isObject(null), false);
  assert.equal(isObject([]), false);
  assert.equal(isObject('string'), false);
});

test('hasOnlyKeys checks allowed keys', () => {
  assert.equal(hasOnlyKeys({ a: 1, b: 2 }, ['a', 'b']), true);
  assert.equal(hasOnlyKeys({ a: 1 }, ['a', 'b']), true);
  assert.equal(hasOnlyKeys({ a: 1, c: 3 }, ['a', 'b']), false);
});

test('MAX_SNAPSHOT_AGE_MS is about one year', () => {
  assert.ok(MAX_SNAPSHOT_AGE_MS > 360 * 24 * 3600 * 1000);
  assert.ok(MAX_SNAPSHOT_AGE_MS < 370 * 24 * 3600 * 1000);
});
