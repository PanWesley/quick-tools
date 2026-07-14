(function() {
  var parser = window.ZhenjiaLinkParser;
  var judge = window.ZhenjiaPriceJudge;
  var db = window.ZhenjiaDB;
  var chart = window.ZhenjiaChart;
  var sampleData = window.ZhenjiaSampleData;
  var exporter = window.ZhenjiaExport;

  var PRICE_API_BASE = '/api/price';
  var priceApi = {
    enabled: false,

    init: function() {
      var self = this;
      return fetch(PRICE_API_BASE + '/config', { method: 'GET' })
        .then(function(response) {
          if (response.ok) {
            self.enabled = true;
            return true;
          }
          self.enabled = false;
          return false;
        })
        .catch(function() {
          self.enabled = false;
          return false;
        });
    },

    resolve: function(input) {
      var self = this;
      if (!self.enabled) return Promise.resolve(null);
      return fetch(PRICE_API_BASE + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: '', text: input })
      }).then(function(response) {
        if (!response.ok) return null;
        return response.json();
      }).catch(function() {
        return null;
      });
    },

    getHistory: function(platform, itemId) {
      var self = this;
      if (!self.enabled || !platform || !itemId) return Promise.resolve([]);
      return fetch(PRICE_API_BASE + '/history?platform=' + encodeURIComponent(platform) + '&item_id=' + encodeURIComponent(itemId), {
        method: 'GET'
      }).then(function(response) {
        if (!response.ok) return [];
        return response.json().then(function(data) {
          return data.snapshots || [];
        });
      }).catch(function() {
        return [];
      });
    },

    recordSnapshot: function(data) {
      var self = this;
      if (!self.enabled) return Promise.resolve(null);
      return fetch(PRICE_API_BASE + '/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function(response) {
        if (!response.ok) return null;
        return response.json();
      }).catch(function() {
        return null;
      });
    }
  };

  var state = {
    view: 'home',
    activeProduct: null,
    activeSnapshots: [],
    activeWatch: null,
    products: [],
    watches: [],
    snapshots: [],
    range: '30'
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    var number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return '暂无';
    return '¥' + (Number.isInteger(number) ? String(number) : number.toFixed(2));
  }

  function mergeSnapshots(local, remote) {
    var seen = new Set();
    var merged = [];
    var all = (local || []).concat(remote || []);
    all.forEach(function(s) {
      var key = (s.capturedAt || '') + '_' + (s.finalPrice || '');
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
    });
    merged.sort(function(a, b) {
      return new Date(a.capturedAt) - new Date(b.capturedAt);
    });
    return merged;
  }

  function setMessage(id, text, options) {
    var element = document.getElementById(id);
    if (!element) return;
    var opts = options || {};
    if (opts.html) {
      element.innerHTML = text || '';
    } else {
      element.textContent = text || '';
    }
  }

  function buildGuideHtml(error) {
    var parts = [];
    if (error && error.extractedTitle) {
      parts.push('<p style="margin:0 0 8px;color:var(--color-ink);font-weight:600;">识别到商品：' + escapeHtml(error.extractedTitle) + '</p>');
    }
    if (error && error.message) {
      parts.push('<p style="margin:0 0 10px;">' + escapeHtml(error.message) + '</p>');
    }
    if (error && error.guideSteps && error.guideSteps.length) {
      parts.push('<ol style="margin:0;padding-left:20px;color:var(--color-muted);line-height:1.8;list-style:none;">');
      error.guideSteps.forEach(function(step) {
        parts.push('<li>' + escapeHtml(step) + '</li>');
      });
      parts.push('</ol>');
    }
    if (error && error.isTaoKouLing) {
      parts.push('<p style="margin:8px 0 0;font-size:12px;">小贴士：淘口令需在淘宝 APP 中打开后再复制详情页链接。</p>');
    }
    return parts.join('');
  }

  var HEADER_TITLES = {
    home: { title: '买前省省', desc: '聪明买买买，不花冤枉钱' },
    watches: { title: '我的关注', desc: '心愿清单，等降价提醒' },
    picks: { title: '好物推荐', desc: '精选划算好物' },
    profile: { title: '我的', desc: '设置与数据管理' },
    analysis: { title: '价格分析', desc: '历史价格与购买建议' }
  };

  function updateHeader(view) {
    var info = HEADER_TITLES[view] || HEADER_TITLES.home;
    var titleEl = $('#app-header-title');
    var descEl = $('#app-header-desc');
    if (titleEl) titleEl.textContent = info.title;
    if (descEl) descEl.textContent = info.desc;
  }

  function switchView(view, pushHistory) {
    state.view = view;
    document.body.dataset.view = view;
    document.querySelectorAll('.view').forEach(function(section) {
      section.classList.toggle('active', section.id === 'view-' + view);
    });
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.classList.toggle('active', button.dataset.view === view);
    });
    updateHeader(view);
    if (pushHistory !== false && location.hash !== '#' + view) {
      location.hash = view === 'home' ? '#home' : '#' + view;
    }
    window.scrollTo(0, 0);
  }

  function handleHashChange() {
    var hash = location.hash.replace('#', '') || 'home';
    var validViews = ['home', 'watches', 'picks', 'profile', 'analysis'];
    if (validViews.indexOf(hash) === -1) hash = 'home';
    if (state.view !== hash) {
      switchView(hash, false);
    }
  }

  function setThemePreference(pref) {
    localStorage.setItem('quick-tools-theme', pref);
    var theme = pref === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : pref;
    document.documentElement.setAttribute('data-theme', theme);
  }

  function setPalette(palette) {
    localStorage.setItem('price-palette', palette);
    document.documentElement.setAttribute('data-palette', palette);
    document.querySelectorAll('[data-palette]').forEach(function(btn) {
      btn.closest('label') && btn.closest('label').classList.toggle('active', btn.value === palette);
    });
  }

  function initThemeControls() {
    var currentTheme = localStorage.getItem('quick-tools-theme') || 'light';
    document.querySelectorAll('[data-theme-pref]').forEach(function(input) {
      input.checked = input.value === currentTheme;
      input.addEventListener('change', function() {
        if (input.checked) setThemePreference(input.value);
      });
    });

    var currentPalette = localStorage.getItem('price-palette') || 'mint';
    document.querySelectorAll('[data-palette]').forEach(function(input) {
      input.checked = input.value === currentPalette;
      input.addEventListener('change', function() {
        if (input.checked) setPalette(input.value);
      });
    });
  }

  function platformLabel(platform) {
    return parser.normalizePlatformLabel(platform);
  }

  function productCard(product, mode) {
    return [
      '<article class="panel product-card">',
      '<p class="eyebrow">', escapeHtml(platformLabel(product.platform)), ' · ', escapeHtml(product.source || 'local'), '</p>',
      '<h3>', escapeHtml(product.title || '未命名商品'), '</h3>',
      '<p class="fine-print">', escapeHtml(product.shopName || '本地记录'), '</p>',
      '<button class="btn secondary" type="button" data-product-id="', escapeHtml(product.id), '" data-open-product="', escapeHtml(mode || 'local'), '">查看分析</button>',
      '</article>'
    ].join('');
  }

  function renderSamples() {
    var container = $('#sample-products');
    if (!container) return;
    container.innerHTML = sampleData.getSampleProducts().map(function(product) {
      return productCard(product, 'sample');
    }).join('');
  }

  function renderRecentWatches() {
    var container = $('#recent-watches');
    if (!container) return;
    var enabled = state.watches.filter(function(watch) {
      return watch.enabled;
    }).slice(0, 4);
    if (!enabled.length) {
      container.innerHTML = '<div class="empty-state"><span class="empty-state-icon">💝</span><p class="empty-state-text">还没关注的商品呢～<br>遇到心仪的就加进来吧</p></div>';
      return;
    }
    container.innerHTML = enabled.map(function(watch) {
      var product = state.products.find(function(item) {
        return item.id === watch.productId;
      });
      return [
        '<article class="panel">',
        '<h3>', escapeHtml(product ? product.title : watch.productId), '</h3>',
        '<p class="fine-print">心愿价 ', escapeHtml(money(watch.targetPrice)), '</p>',
        '<button class="btn ghost" type="button" data-product-id="', escapeHtml(watch.productId), '" data-open-product="local">看看价格</button>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderWatchList() {
    var container = $('#watch-list');
    if (!container) return;
    if (!state.watches.length) {
      container.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🛍️</span><p class="empty-state-text">心愿清单空空的～<br>去看看有没有什么想买的吧</p></div>';
      return;
    }
    container.innerHTML = state.watches.map(function(watch) {
      var product = state.products.find(function(item) {
        return item.id === watch.productId;
      });
      var snapshots = snapshotsForProduct(watch.productId);
      var latest = latestSnapshot(snapshots);
      return [
        '<article class="panel">',
        '<h2>', escapeHtml(product ? product.title : watch.productId), '</h2>',
        '<p>心愿价 ', escapeHtml(money(watch.targetPrice)), ' · 最近记录 ', escapeHtml(money(latest && latest.finalPrice)), '</p>',
        '<div class="button-row">',
        '<button class="btn secondary" type="button" data-product-id="', escapeHtml(watch.productId), '" data-open-product="local">看看详情</button>',
        '<button class="btn ghost" type="button" data-delete-watch="', escapeHtml(watch.id), '">取消关注</button>',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
  }

  function renderPicks() {
    var container = $('#picks-grid');
    if (!container) return;
    var samples = sampleData.getSampleProducts();
    var badges = ['历史低价', '大额券', '限时特惠', '新品推荐'];
    container.innerHTML = samples.map(function(product, index) {
      var snapshots = sampleData.getSampleSnapshots(product.id);
      var prices = snapshots.map(function(s) { return s.finalPrice; }).filter(Boolean);
      var minPrice = prices.length ? Math.min.apply(null, prices) : 0;
      var maxPrice = prices.length ? Math.max.apply(null, prices) : 0;
      var badgeClass = index % 2 === 0 ? 'low-price' : '';
      return [
        '<article class="pick-card" data-product-id="', escapeHtml(product.id), '" data-open-product="sample">',
        '<span class="pick-badge ', badgeClass, '">', escapeHtml(badges[index % badges.length]), '</span>',
        '<p class="pick-platform">', escapeHtml(platformLabel(product.platform)), '</p>',
        '<h3 class="pick-title">', escapeHtml(product.title || '未命名商品'), '</h3>',
        '<div class="pick-price">',
          escapeHtml(money(minPrice)),
          maxPrice > minPrice ? '<span class="pick-original">' + escapeHtml(money(maxPrice)) + '</span>' : '',
        '</div>',
        '</article>'
      ].join('');
    }).join('');
  }

  function snapshotsForProduct(productId) {
    return state.snapshots.filter(function(snapshot) {
      return snapshot.productId === productId;
    });
  }

  function watchForProduct(productId) {
    return state.watches.find(function(watch) {
      return watch.productId === productId && watch.enabled;
    }) || null;
  }

  function latestSnapshot(snapshots) {
    return snapshots.slice().sort(function(a, b) {
      return String(b.capturedAt).localeCompare(String(a.capturedAt));
    })[0] || null;
  }

  function filteredSnapshots(snapshots) {
    if (state.range === 'all') return snapshots;
    var days = Number(state.range || 30);
    var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return snapshots.filter(function(snapshot) {
      return new Date(snapshot.capturedAt).getTime() >= cutoff;
    });
  }

  function renderAnalysis(product, snapshots, watch) {
    var latest = latestSnapshot(snapshots);
    var currentPrice = latest ? latest.finalPrice : 0;
    var result = judge.judgePrice({
      currentFinalPrice: currentPrice,
      snapshots: snapshots,
      nowIso: new Date().toISOString()
    });

    state.activeProduct = product;
    state.activeSnapshots = snapshots;
    state.activeWatch = watch || null;

    var noticeHtml = '';
    if (product && product.notice) {
      noticeHtml = '<p style="margin:12px 0 0;padding:10px 14px;border-radius:var(--radius-sm);background:var(--color-gold-soft);color:var(--color-gold);font-size:13px;font-weight:600;">' + escapeHtml(product.notice) + '</p>';
    }

    var verdictEmoji = '🤔';
    var verdictLabel = '再看看';
    if (result.level === 'history_low' || result.level === 'recent_low') {
      verdictEmoji = '✨';
      verdictLabel = '好时机';
    } else if (result.level === 'expensive') {
      verdictEmoji = '💸';
      verdictLabel = '有点贵';
    } else {
      verdictEmoji = '😊';
      verdictLabel = '还可以';
    }

    $('#truth-bench').className = 'truth-bench level-' + escapeHtml(result.level);
    $('#truth-bench').innerHTML = [
      '<div class="truth-copy">',
        '<p class="eyebrow">', escapeHtml(platformLabel(product.platform)), ' · ', escapeHtml(product.source || 'local'), '</p>',
        '<div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;padding:6px 14px;border-radius:999px;background:',
          result.level === 'expensive' ? 'var(--color-rose-soft)' : 'var(--color-primary-soft)',
          ';color:',
          result.level === 'expensive' ? 'var(--color-rose-deep)' : 'var(--color-primary-deep)',
          ';font-weight:600;font-size:14px;">',
          '<span>', verdictEmoji, '</span>',
          verdictLabel,
        '</div>',
        '<h1>', escapeHtml(result.title), '</h1>',
        '<div class="current-price-display">',
          '<span class="price-label">当前价</span>',
          '<span class="price-value">', escapeHtml(money(currentPrice)), '</span>',
        '</div>',
        '<p>', escapeHtml(result.suggestion), '</p>',
        '<p style="margin-top:8px;font-size:14px;color:var(--color-muted);">', escapeHtml(product.title), '</p>',
        '<ul>', result.reasons.map(function(reason) {
          return '<li>' + escapeHtml(reason) + '</li>';
        }).join(''), '</ul>',
        noticeHtml,
      '</div>',
      '<div class="score-column">',
        '<span class="score-label">入手推荐度</span>',
        '<div class="score-ring" style="--score:', String(result.score), '"><span>', String(result.score), '</span></div>',
      '</div>'
    ].join('');

    chart.renderPriceChart($('#price-chart'), filteredSnapshots(snapshots));
    $('#watch-target').value = watch && watch.targetPrice ? watch.targetPrice : '';
    switchView('analysis');
  }

  function openSample(productId) {
    var product = sampleData.getSampleProducts().find(function(item) {
      return item.id === productId;
    });
    if (!product) return;
    renderAnalysis(product, sampleData.getSampleSnapshots(productId), null);
  }

  function openLocalProduct(productId) {
    var product = state.products.find(function(item) {
      return item.id === productId;
    });
    if (!product) return;
    renderAnalysis(product, snapshotsForProduct(product.id), watchForProduct(product.id));
  }

  function loadAllData() {
    if (!window.indexedDB) {
      setMessage('parse-message', '浏览器不支持本地数据库，无法保存关注和价格记录。');
      renderSamples();
      renderRecentWatches();
      renderWatchList();
      renderPicks();
      return Promise.resolve();
    }
    return db.getAllData().then(function(data) {
      state.products = data.products;
      state.snapshots = data.priceSnapshots;
      state.watches = data.watches;
      renderSamples();
      renderRecentWatches();
      renderWatchList();
      renderPicks();
    }).catch(function(error) {
      setMessage('parse-message', error.message || '读取本地数据失败。');
    });
  }

  function createParsedProduct(parsed) {
    var title = parsed.title || parsed.extractedTitle ||
      (parser.normalizePlatformLabel(parsed.platform) + '商品 ' + parsed.itemId);
    return db.upsertProduct({
      platform: parsed.platform,
      itemId: parsed.itemId,
      skuId: parsed.skuId || '',
      shopId: parsed.shopId || '',
      title: title,
      shopName: parsed.isShortLink ? '短链识别' : '本地解析',
      rawUrl: parsed.rawUrl || '',
      canonicalUrl: parsed.canonicalUrl || '',
      source: parsed.source || 'parsed',
      isShortLink: parsed.isShortLink || false
    }).then(function(product) {
      return loadAllData().then(function() {
        var found = state.products.find(function(item) {
          return item.id === product.id;
        }) || product;
        if (parsed.notice) {
          found.notice = parsed.notice;
        }
        return found;
      });
    });
  }

  function sampleSnapshotsForSavedProduct(originalProductId, savedProductId) {
    return sampleData.getSampleSnapshots(originalProductId).map(function(snapshot, index) {
      return Object.assign({}, snapshot, {
        id: 'sample_snap_' + savedProductId + '_' + index,
        productId: savedProductId
      });
    });
  }

  function seedSampleSnapshots(product, originalProductId) {
    var hasSampleSnapshots;
    var writes;

    if (!product || product.source !== 'sample') return Promise.resolve(product);

    hasSampleSnapshots = state.snapshots.some(function(snapshot) {
      return snapshot.productId === product.id && snapshot.source === 'sample';
    });
    if (hasSampleSnapshots) return Promise.resolve(product);

    writes = sampleSnapshotsForSavedProduct(originalProductId || product.id, product.id);
    if (!writes.length) return Promise.resolve(product);

    return Promise.all(writes.map(function(snapshot) {
      return db.addPriceSnapshot(snapshot);
    })).then(loadAllData).then(function() {
      state.activeProduct = state.products.find(function(item) {
        return item.id === product.id;
      }) || product;
      return state.activeProduct;
    });
  }

  function ensureActiveProductSaved() {
    if (!state.activeProduct) return Promise.reject(new Error('missing active product'));
    var originalProductId = state.activeProduct.id;
    var existing = state.products.find(function(product) {
      return product.id === state.activeProduct.id;
    });
    if (existing) return seedSampleSnapshots(existing, originalProductId);
    return db.upsertProduct(Object.assign({}, state.activeProduct, {
      source: state.activeProduct.source === 'sample' ? 'sample' : state.activeProduct.source
    })).then(function(product) {
      return loadAllData().then(function() {
        state.activeProduct = state.products.find(function(item) {
          return item.id === product.id;
        }) || product;
        return seedSampleSnapshots(state.activeProduct, originalProductId);
      });
    });
  }

  function importPayload(payload) {
    var valid = exporter.validateImportPayload(payload);
    if (!valid.ok) return Promise.reject(new Error(valid.error.message));
    return db.clearAll().then(function() {
      var writes = [];
      valid.data.products.forEach(function(product) {
        writes.push(db.upsertProduct(product));
      });
      valid.data.priceSnapshots.forEach(function(snapshot) {
        writes.push(db.addPriceSnapshot(snapshot));
      });
      valid.data.watches.forEach(function(watch) {
        writes.push(db.upsertWatch(watch));
      });
      return Promise.all(writes);
    });
  }

  function bindEvents() {
    $('#parse-form').addEventListener('submit', function(event) {
      event.preventDefault();
      setMessage('parse-message', '正在解析...');
      var input = $('#product-input').value;

      function handleLocalFallback() {
        var result = parser.parseProductInput(input);
        if (!result.ok) {
          var err = result.error;
          var needsGuide = err.guideSteps || err.extractedTitle || err.isTaoKouLing;
          if (needsGuide) {
            setMessage('parse-message', buildGuideHtml(err), { html: true });
          } else {
            setMessage('parse-message', err.message);
          }
          return;
        }
        createParsedProduct(result.data).then(function(product) {
          renderAnalysis(product, snapshotsForProduct(product.id), watchForProduct(product.id));
          $('#product-input').value = '';
        }).catch(function(error) {
          setMessage('parse-message', error.message || '解析后保存商品失败。');
        });
      }

      priceApi.resolve(input).then(function(remoteResult) {
        if (!remoteResult || remoteResult.error) {
          handleLocalFallback();
          return;
        }

        var platform = remoteResult.platform || '';
        var itemId = remoteResult.itemId || '';
        var title = remoteResult.title || '';
        var resolved = remoteResult.resolved === true;

        if (!platform && !title) {
          handleLocalFallback();
          return;
        }

        var parsed = {
          platform: platform || 'unknown',
          itemId: itemId || ('api_' + Date.now().toString(36)),
          skuId: remoteResult.skuId || '',
          shopId: remoteResult.shopId || '',
          title: title || (platform ? parser.normalizePlatformLabel(platform) + '商品' : '商品'),
          rawUrl: remoteResult.rawUrl || '',
          canonicalUrl: remoteResult.canonicalUrl || '',
          source: resolved ? 'api_resolved' : 'api_partial',
          isShortLink: !resolved,
          notice: remoteResult.notice || ''
        };

        createParsedProduct(parsed).then(function(product) {
          var localSnapshots = snapshotsForProduct(product.id);
          if (resolved && remoteResult.itemId) {
            priceApi.getHistory(platform, itemId).then(function(remoteSnapshots) {
              if (remoteSnapshots && remoteSnapshots.length > 0) {
                var merged = mergeSnapshots(localSnapshots, remoteSnapshots);
                renderAnalysis(product, merged, watchForProduct(product.id));
              } else {
                renderAnalysis(product, localSnapshots, watchForProduct(product.id));
              }
            }).catch(function() {
              renderAnalysis(product, localSnapshots, watchForProduct(product.id));
            });
          } else {
            renderAnalysis(product, localSnapshots, watchForProduct(product.id));
          }
          $('#product-input').value = '';
        }).catch(function(error) {
          setMessage('parse-message', error.message || '解析后保存商品失败。');
        });
      }).catch(function() {
        handleLocalFallback();
      });
    });

    $('#use-sample-button').addEventListener('click', function() {
      var first = sampleData.getSampleProducts()[0];
      if (first) openSample(first.id);
    });

    document.addEventListener('click', function(event) {
      var openButton = event.target.closest('[data-open-product]');
      var viewButton = event.target.closest('[data-view], [data-view-link]');
      var rangeButton = event.target.closest('[data-range]');
      var deleteWatch = event.target.closest('[data-delete-watch]');

      if (openButton) {
        if (openButton.dataset.openProduct === 'sample') openSample(openButton.dataset.productId);
        else openLocalProduct(openButton.dataset.productId);
      }
      if (viewButton) {
        switchView(viewButton.dataset.view || viewButton.dataset.viewLink);
      }
      if (rangeButton) {
        state.range = rangeButton.dataset.range;
        document.querySelectorAll('[data-range]').forEach(function(button) {
          button.classList.toggle('active', button === rangeButton);
        });
        chart.renderPriceChart($('#price-chart'), filteredSnapshots(state.activeSnapshots));
      }
      if (deleteWatch) {
        db.deleteOne('watches', deleteWatch.dataset.deleteWatch).then(loadAllData);
      }
    });

    $('#snapshot-form').addEventListener('submit', function(event) {
      event.preventDefault();
      if (!state.activeProduct) return;
      var price = Number($('#snapshot-price').value);
      if (!Number.isFinite(price) || price <= 0) return;
      var note = $('#snapshot-note').value;
      var capturedAt = new Date().toISOString();
      var product = state.activeProduct;

      ensureActiveProductSaved().then(function(savedProduct) {
        product = savedProduct;
        return db.addPriceSnapshot({
          productId: savedProduct.id,
          capturedAt: capturedAt,
          listPrice: price,
          promoPrice: price,
          couponPrice: price,
          finalPrice: price,
          promotionInfo: note,
          source: 'manual',
          stockStatus: 'unknown'
        });
      }).then(loadAllData).then(function() {
        renderAnalysis(product, snapshotsForProduct(product.id), watchForProduct(product.id));
        $('#snapshot-price').value = '';
        $('#snapshot-note').value = '';

        if (priceApi.enabled && product.platform && product.itemId &&
            product.itemId.indexOf('short_') !== 0 &&
            product.itemId.indexOf('tkl_') !== 0 &&
            product.itemId.indexOf('text_') !== 0 &&
            product.itemId.indexOf('unknown_') !== 0) {
          priceApi.recordSnapshot({
            platform: product.platform,
            itemId: product.itemId,
            finalPrice: price,
            listPrice: price,
            promoPrice: null,
            couponPrice: null,
            note: note,
            stockStatus: 'unknown',
            capturedAt: capturedAt,
            title: product.title
          });
        }
      });
    });

    $('#watch-form').addEventListener('submit', function(event) {
      event.preventDefault();
      if (!state.activeProduct) return;
      var target = Number($('#watch-target').value);
      if (!Number.isFinite(target) || target <= 0) return;
      ensureActiveProductSaved().then(function(product) {
        return db.upsertWatch({
          productId: product.id,
          targetPrice: target,
          watchType: 'target_price',
          enabled: true
        });
      }).then(loadAllData).then(function() {
        renderAnalysis(state.activeProduct, snapshotsForProduct(state.activeProduct.id), watchForProduct(state.activeProduct.id));
      });
    });

    function handleExport() {
      db.getAllData().then(function(data) {
        var payload = exporter.buildExportPayload(data);
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'zhenjia-assistant-backup.json';
        link.click();
        URL.revokeObjectURL(url);
        setMessage('data-message', '导出已开始。');
        setMessage('profile-data-message', '导出已开始。');
      }).catch(function(error) {
        setMessage('data-message', error.message || '导出失败。');
        setMessage('profile-data-message', error.message || '导出失败。');
      });
    }
    var exportBtn = $('#export-button') || $('#profile-export-button');
    if ($('#export-button')) $('#export-button').addEventListener('click', handleExport);
    if ($('#profile-export-button')) $('#profile-export-button').addEventListener('click', handleExport);

    function handleImport(event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      file.text().then(function(text) {
        return importPayload(JSON.parse(text));
      }).then(loadAllData).then(function() {
        setMessage('data-message', '导入完成。');
        setMessage('profile-data-message', '导入完成。');
        event.target.value = '';
      }).catch(function(error) {
        setMessage('data-message', error.message || '导入失败。');
        setMessage('profile-data-message', error.message || '导入失败。');
      });
    }
    if ($('#import-file')) $('#import-file').addEventListener('change', handleImport);
    if ($('#profile-import-file')) $('#profile-import-file').addEventListener('change', handleImport);

    function handleClear() {
      if (confirm('确定清空买前省省的本地数据吗？')) {
        db.clearAll().then(loadAllData).then(function() {
          setMessage('data-message', '本地数据已清空。');
          setMessage('profile-data-message', '本地数据已清空。');
        });
      }
    }
    if ($('#clear-button')) $('#clear-button').addEventListener('click', handleClear);
    if ($('#profile-clear-button')) $('#profile-clear-button').addEventListener('click', handleClear);

    initThemeControls();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/tools/price/sw.js').catch(function(error) {
        console.warn('[Zhenjia] Service worker registration failed:', error);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    bindEvents();
    loadAllData();
    registerServiceWorker();
    priceApi.init();
  });
})();
