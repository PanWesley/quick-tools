(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZhenjiaSampleData = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  var MS_PER_DAY = 24 * 60 * 60 * 1000;
  var BASE_TIME = Date.now();
  var SAMPLE_PRODUCTS = [
    {
      id: 'sample_keyboard',
      platform: 'jd',
      itemId: '100012043978',
      skuId: '100012043978',
      shopId: '',
      title: '示例：机械键盘 87 键无线版',
      shopName: '示例数码旗舰店',
      imageUrl: '',
      rawUrl: 'https://item.jd.com/100012043978.html',
      canonicalUrl: 'https://item.jd.com/100012043978.html',
      source: 'sample'
    },
    {
      id: 'sample_monitor',
      platform: 'tmall',
      itemId: '645112233445',
      skuId: '',
      shopId: '',
      title: '示例：27 英寸 4K 显示器',
      shopName: '示例办公装备店',
      imageUrl: '',
      rawUrl: 'https://detail.tmall.com/item.htm?id=645112233445',
      canonicalUrl: 'https://detail.tmall.com/item.htm?id=645112233445',
      source: 'sample'
    },
    {
      id: 'sample_tissue',
      platform: 'pdd',
      itemId: '531222333444',
      skuId: '',
      shopId: '',
      title: '示例：家庭抽纸囤货装',
      shopName: '示例日用品店',
      imageUrl: '',
      rawUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=531222333444',
      canonicalUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=531222333444',
      source: 'sample'
    }
  ];

  var PRICE_SERIES = {
    sample_keyboard: [599, 579, 549, 529, 519, 499, 539, 509, 489, 469],
    sample_monitor: [1899, 1799, 1699, 1749, 1599, 1549, 1499, 1529, 1469, 1399],
    sample_tissue: [69, 65, 59, 62, 55, 52, 49, 53, 47, 45]
  };

  function isoDaysAgo(days) {
    return new Date(BASE_TIME - days * MS_PER_DAY).toISOString();
  }

  function cloneObject(value) {
    return Object.assign({}, value);
  }

  function getSampleProducts() {
    var createdAt = isoDaysAgo(100);
    var updatedAt = isoDaysAgo(0);
    return SAMPLE_PRODUCTS.map(function(product) {
      return Object.assign({}, product, {
        createdAt: createdAt,
        updatedAt: updatedAt
      });
    });
  }

  function getSampleSnapshots(productId) {
    var series = PRICE_SERIES[productId] || [];
    return series.map(function(finalPrice, index) {
      var daysAgo = (series.length - index) * 8;
      var capturedAt = isoDaysAgo(daysAgo);
      return cloneObject({
        id: 'sample_snap_' + productId + '_' + index,
        productId: productId,
        finalPrice: finalPrice,
        listPrice: finalPrice + Math.max(10, Math.round(finalPrice * 0.12)),
        promoPrice: finalPrice + Math.max(5, Math.round(finalPrice * 0.06)),
        couponPrice: finalPrice,
        promotionInfo: '示例价格记录',
        couponInfo: '',
        stockStatus: 'in_stock',
        source: 'sample',
        capturedAt: capturedAt,
        createdAt: capturedAt
      });
    });
  }

  return {
    getSampleProducts: getSampleProducts,
    getSampleSnapshots: getSampleSnapshots
  };
});
