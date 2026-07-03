const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseProductInput,
  normalizePlatformLabel
} = require('./link-parser.js');

test('parseProductInput extracts a JD sku from a product page URL', () => {
  const result = parseProductInput('https://item.jd.com/100012043978.html?utm_source=test');
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, 'jd');
  assert.equal(result.data.itemId, '100012043978');
  assert.equal(result.data.skuId, '100012043978');
  assert.equal(result.data.canonicalUrl, 'https://item.jd.com/100012043978.html');
});

test('parseProductInput extracts a Taobao item id from share text', () => {
  const result = parseProductInput('看看这个 https://item.taobao.com/item.htm?id=726477321880&spm=a21 复制打开');
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
});

test('parseProductInput rejects short links with a specific error', () => {
  const result = parseProductInput('https://m.tb.cn/h.abc123');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'short_link_unsupported');
});

test('parseProductInput rejects unsupported platforms', () => {
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
