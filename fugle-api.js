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
    if (['^TSE', '^TWSE', 'TWSE', 'TAIEX', 'IR0001'].includes(raw)) return 'IR0001';
    const code = raw.replace(/^(TWSE|TPEX|TSE|OTC):/, '').replace(/\.(TW|TWO)$/, '');
    if (!/^[0-9]{4,6}[A-Z]?$/.test(code)) throw new Error('無效的富果股票代號：' + raw);
    return code;
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

  function parseQuote(data) {
    if (!data || typeof data !== 'object') return null;
    const last = price(data.lastPrice, data.closePrice, data.lastTrade?.price, data.index);
    if (last == null) return null;
    return {
      price: last,
      open: price(data.openPrice, data.previousClose) ?? last,
      high: price(data.highPrice),
      low: price(data.lowPrice),
    };
  }

  function httpError(status, code) {
    const cause = status === 404 ? '路由或代號不存在'
      : status === 401 || status === 403 ? 'API Key 或行情權限異常'
      : status === 429 ? '超出 API 方案速率限制'
      : status === 400 ? '請求參數錯誤'
      : '請檢查網路或服務';
    return 'HTTP ' + status + ' [' + code + ']：' + cause;
  }

  const result = { REST_BASE, normalizeRestBase, normalizeSymbol, buildQuoteUrl, parseQuote, httpError };
  if (typeof module === 'object' && module.exports) module.exports = result;
  root.SuperETFFugleAPI = result;
})(globalThis);
