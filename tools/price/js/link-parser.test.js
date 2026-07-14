const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseProductInput,
  normalizePlatformLabel,
  extractProductTitle,
  detectPlatformFromText
} = require('./link-parser.js');

test('parseProductInput extracts a JD sku from a product page URL', () => {
  const result = parseProductInput('https://item.jd.com/100012043978.html?utm_source=test');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.itemId, '100012043978');
  assert.equal(result.data.skuId, '100012043978');
  assert.equal(result.data.canonicalUrl, 'https://item.jd.com/100012043978.html');
  assert.equal(result.data.isShortLink, undefined);
});

test('parseProductInput extracts JD sku from mobile product URL', () => {
  const result = parseProductInput('https://item.m.jd.com/product/100012043978.html');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.itemId, '100012043978');
});

test('parseProductInput trims sentence punctuation after a JD product URL', () => {
  const result = parseProductInput('降价了：https://item.jd.com/100012043978.html.');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.itemId, '100012043978');
  assert.equal(result.data.canonicalUrl, 'https://item.jd.com/100012043978.html');
});

test('parseProductInput extracts a Taobao item id from share text', () => {
  const result = parseProductInput('看看这个 https://item.taobao.com/item.htm?id=726477321880&spm=a21 复制打开');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'taobao');
  assert.equal(result.data.itemId, '726477321880');
  assert.equal(result.data.canonicalUrl, 'https://item.taobao.com/item.htm?id=726477321880');
});

test('parseProductInput trims sentence punctuation after a Taobao product URL', () => {
  const result = parseProductInput('看看这个 https://item.taobao.com/item.htm?id=726477321880.');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'taobao');
  assert.equal(result.data.itemId, '726477321880');
  assert.equal(result.data.canonicalUrl, 'https://item.taobao.com/item.htm?id=726477321880');
});

test('parseProductInput extracts a Tmall item id', () => {
  const result = parseProductInput('https://detail.tmall.com/item.htm?id=645112233445&abbucket=1');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'tmall');
  assert.equal(result.data.itemId, '645112233445');
  assert.equal(result.data.canonicalUrl, 'https://detail.tmall.com/item.htm?id=645112233445');
});

test('parseProductInput extracts a PDD goods id', () => {
  const result = parseProductInput('https://mobile.yangkeduo.com/goods.html?goods_id=531222333444');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'pdd');
  assert.equal(result.data.itemId, '531222333444');
  assert.equal(result.data.canonicalUrl, 'https://mobile.yangkeduo.com/goods.html?goods_id=531222333444');
  assert.equal(result.data.isShortLink, undefined);
});

test('parseProductInput handles JD short link by creating local product with title', () => {
  const text = '【京东】https://3.cn/-2Vv3ukm?jkl=@W0Yzw10kN4h@ MU5104 「初申针织女薄款内外搭外套」\n点击链接直接打开 或者复制文案打开京东';
  const result = parseProductInput(text);
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.isShortLink, true);
  assert.equal(result.data.title, '初申针织女薄款内外搭外套');
  assert.equal(result.data.extractedTitle, '初申针织女薄款内外搭外套');
  assert.ok(result.data.notice);
  assert.ok(result.data.notice.indexOf('京东') >= 0);
  assert.ok(result.data.source === 'short_link');
});

test('parseProductInput handles Taobao e.tb.cn short link with title extraction', () => {
  const text = '【淘宝】7天无理由退货\nhttps://e.tb.cn/h.8bHMm3ebr9c2xTr?tk=0u02gqqp66J CZ356 「早春碎花雪纺连衣裙女夏2026年新款女装显瘦时尚气质仙女蛋糕裙子」';
  const result = parseProductInput(text);
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'taobao');
  assert.equal(result.data.isShortLink, true);
  assert.equal(result.data.title, '早春碎花雪纺连衣裙女夏2026年新款女装显瘦时尚气质仙女蛋糕裙子');
  assert.ok(result.data.notice);
  assert.ok(result.data.source === 'short_link');
});

test('parseProductInput handles PDD ps parameter link as short link with title', () => {
  const text = '【拼多多】百亿补贴 超划算 https://mobile.yangkeduo.com/goods.html?ps=e1xaEqLYy8 「家庭抽纸囤货装」';
  const result = parseProductInput(text);
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'pdd');
  assert.equal(result.data.isShortLink, true);
  assert.equal(result.data.title, '家庭抽纸囤货装');
  assert.ok(result.data.notice);
});

test('parseProductInput handles m.tb.cn short link', () => {
  const result = parseProductInput('https://m.tb.cn/h.abc123 「测试商品标题」');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'taobao');
  assert.equal(result.data.isShortLink, true);
  assert.equal(result.data.title, '测试商品标题');
});

test('parseProductInput handles tao kou ling without URL', () => {
  const text = '【淘宝】￥abcdefgh12￥ 「超级好用的商品」';
  const result = parseProductInput(text);
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'taobao');
  assert.equal(result.data.isShortLink, true);
  assert.equal(result.data.isTaoKouLing, true);
  assert.equal(result.data.title, '超级好用的商品');
  assert.ok(result.data.notice);
});

test('parseProductInput extracts product title from direct parseable URL', () => {
  const text = '【京东】降价啦！https://item.jd.com/100012043978.html 「机械键盘 87键无线版」';
  const result = parseProductInput(text);
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.extractedTitle, '机械键盘 87键无线版');
});

test('extractProductTitle extracts title from corner brackets', () => {
  const title = extractProductTitle('【京东】...「初申针织女薄款内外搭外套」...');
  assert.equal(title, '初申针织女薄款内外搭外套');
});

test('detectPlatformFromText detects JD from 【京东】 tag', () => {
  assert.equal(detectPlatformFromText('【京东】xxx'), 'jd');
  assert.equal(detectPlatformFromText('【淘宝】xxx'), 'taobao');
  assert.equal(detectPlatformFromText('【天猫】xxx'), 'tmall');
  assert.equal(detectPlatformFromText('【拼多多】xxx'), 'pdd');
});

test('detectPlatformFromText detects Taobao from tao kou ling', () => {
  assert.equal(detectPlatformFromText('这是一个淘口令￥abcdefgh12￥试试'), 'taobao');
});

test('parseProductInput rejects empty input with no URL or title', () => {
  const result = parseProductInput('随便一些文字');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'missing_url');
});

test('parseProductInput rejects invalid URL', () => {
  const result = parseProductInput('https://[invalid');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_url');
});

test('parseProductInput rejects completely unsupported platforms without title', () => {
  const result = parseProductInput('https://example.com/item/123');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unsupported_platform');
});

test('normalizePlatformLabel returns Chinese display labels', () => {
  assert.equal(normalizePlatformLabel('jd'), '京东');
  assert.equal(normalizePlatformLabel('taobao'), '淘宝');
  assert.equal(normalizePlatformLabel('tmall'), '天猫');
  assert.equal(normalizePlatformLabel('pdd'), '拼多多');
  assert.equal(normalizePlatformLabel('unknown'), '未知平台');
});
