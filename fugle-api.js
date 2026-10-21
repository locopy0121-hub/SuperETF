// SuperETF / Fugle Market Data v1.0 共用工具
(function (root) {
  'use strict';
  const REST_BASE = 'https://api.fugle.tw/marketdata/v1.0';

  function normalizeRestBase(value) {
    const input = String(value ?? '').trim();
    if (!input) return REST_BASE;
    let url;
    try { url = new URL(input); }
    catch { throw new Error('Base URL 必須是完整 HTTPS 網址'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.search || url.hash) throw new Error('Base URL 不得包含 HTTP、帳密、埠號或 query');
    // 兼容舊版誤植的 api.fuguo.tw 網域
    if (url.hostname === 'api.fuguo.tw') return REST_BASE;
    if (url.hostname !== 'api.fugle.tw') {
      throw new Error('保護 API Key：僅可使用官方 api.fugle.tw 主機');
    }
    const path = url.pathname.replace(/\/+$/, '');
    if (['', '/marketdata/v1.0', '/marketdata/v1.0/stock',
         '/marketdata/v1.0/stock/intraday/quote'].includes(path) ||
        /^\/marketdata\/v1\.0\/stock\/intraday\/quote\/[A-Za-z0-9^]+$/.test(path) ||
        /^\/realtime\/v0\.3(?:\/|$)/.test(path)) return REST_BASE;
    throw new Error('不支援的端點，請使用 ' + REST_BASE);
  }

  function normalizeSymbol(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (['^TSE','^TWSE','^TWII','TWSE','TAIEX','IX0001'].includes(raw)) return 'IX0001';
    if(raw==='IR0001')return 'IR0001';
    const code = raw.replace(/^(TWSE|TPEX|TSE|OTC):/, '').replace(/\.(TW|TWO)$/, '');
    if (!/^(?:[0-9]{4,6}[A-Z]?|I[RX][0-9]{4})$/.test(code)) throw new Error('無效的富果股票代號：' + raw);
    return code;
  }

  function buildTickerUrl(base, symbol) {
    return normalizeRestBase(base) + '/stock/intraday/ticker/' +
      encodeURIComponent(normalizeSymbol(symbol));
  }
  function buildQuoteUrl(base, symbol) {
    return normalizeRestBase(base) + '/stock/intraday/quote/' +
      encodeURIComponent(normalizeSymbol(symbol));
  }

  function price(...values) {
    for (const v of values) {
      if (v == null || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  // REST 200 only means request success; premarket may have referencePrice but no trade.
  function parseQuote(data) {
    const d = data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    const traded = price(d.lastPrice, d.lastTrade?.price, d.closePrice, d.lastIndex);
    const trial = price(d.lastTrial?.price);
    const reference = price(d.referencePrice);
    const previousClose = price(d.previousClose);
    let value, kind;
    if (traded != null) {
      value = traded;
      kind = d.isTrial ? 'trial' : (d.isClose ? 'close' : 'trade');
    } else if (d.isTrial && trial != null) {
      value = trial; kind = 'trial';
    } else if (reference != null) {
      value = reference; kind = 'reference';
    } else if (previousClose != null) {
      value = previousClose; kind = 'previous';
    } else {
      return null;
    }
    return {
      price: value,
      open: price(d.openPrice) ?? reference ?? previousClose ?? value,
      high: price(d.highPrice),
      low: price(d.lowPrice),
      previousClose,
      kind,
    };
  }

  function quoteStatus(quote) {
    if (!quote) return 'HTTP 200 已連線，但尚無成交價／參考價／昨收價資料';
    const labels = {
      trade: '最新成交價', close: '收盤價', trial: '試撮價（非正式成交）',
      reference: '盤前參考價（尚無成交）', previous: '昨收價（尚無成交）',
    };
    return (labels[quote.kind] || '行情價格') + ' ' + quote.price;
  }

  function httpError(status, code) {
    const cause = status === 404 ? '路由或代號不存在'
      : status === 401 || status === 403 ? 'API Key 或行情權限異常'
      : status === 429 ? '超出 API 方案速率限制'
      : status === 400 ? '請求參數錯誤'
      : '請檢查網路或服務';
    return 'HTTP ' + status + ' [' + code + ']：' + cause;
  }

  const result = { REST_BASE, normalizeRestBase, normalizeSymbol, buildTickerUrl, buildQuoteUrl, parseQuote, quoteStatus, httpError };
  if (typeof module === 'object' && module.exports) module.exports = result;
  root.SuperETFFugleAPI = result;
})(globalThis);
