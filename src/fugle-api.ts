// SuperETF / Fugle Market Data v1.0 共用工具
export const REST_BASE = 'https://api.fugle.tw/marketdata/v1.0';

export function normalizeRestBase(value: string): string {
  const input = String(value ?? '').trim();
  if (!input) return REST_BASE;
  let url: URL;
  try { url = new URL(input); }
  catch { throw new Error('Base URL 必須是完整 HTTPS 網址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.search || url.hash) throw new Error('Base URL 不得包含 HTTP、帳密、埠號或 query');
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

export function normalizeSymbol(value: string): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (['^TSE', '^TWSE', 'TWSE', 'TAIEX', 'IR0001'].includes(raw)) return 'IR0001';
  const code = raw.replace(/^(TWSE|TPEX|TSE|OTC):/, '').replace(/\.(TW|TWO)$/, '');
  if (!/^[0-9]{4,6}[A-Z]?$/.test(code)) throw new Error('無效的富果股票代號：' + raw);
  return code;
}

export function buildQuoteUrl(base: string, symbol: string): string {
  return normalizeRestBase(base) + '/stock/intraday/quote/' +
    encodeURIComponent(normalizeSymbol(symbol));
}

export function price(...values: Array<number | string | null | undefined>): number | null {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export type QuoteKind = 'trade' | 'close' | 'trial' | 'reference' | 'previous';

export interface ParsedQuote {
  price: number;
  open: number;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  kind: QuoteKind;
}

interface RawQuotePayload {
  [key: string]: unknown;
}

// REST 200 only means request success; premarket may have referencePrice but no trade.
export function parseQuote(data: unknown): ParsedQuote | null {
  // 先安全地取出 data.data（若存在），否則直接使用 data 本身
  let payload: unknown;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const maybeObj = data as Record<string, unknown>;
    const inner = maybeObj['data'];
    payload = (inner && typeof inner === 'object' && !Array.isArray(inner)) ? inner : data;
  } else {
    payload = data;
  }

  const d = payload as RawQuotePayload | null | undefined;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const record = d as unknown as Record<string, unknown>;

  const traded = price(
    record.lastPrice as number | string | null | undefined,
    (record.lastTrade as { price?: unknown } | undefined)?.price as number | string | null | undefined,
    record.closePrice as number | string | null | undefined,
  );
  const trial = price((record.lastTrial as { price?: unknown } | undefined)?.price as number | string | null | undefined);
  const reference = price(record.referencePrice as number | string | null | undefined);
  const previousClose = price(record.previousClose as number | string | null | undefined);
  const openPrice = price(record.openPrice as number | string | null | undefined);
  const high = price(record.highPrice as number | string | null | undefined);
  const low = price(record.lowPrice as number | string | null | undefined);
  const isTrial = Boolean(record.isTrial);
  const isClose = Boolean(record.isClose);

  let value: number;
  let kind: QuoteKind;
  if (traded != null) {
    value = traded;
    kind = isTrial ? 'trial' : (isClose ? 'close' : 'trade');
  } else if (isTrial && trial != null) {
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
    open: openPrice ?? reference ?? previousClose ?? value,
    high,
    low,
    previousClose,
    kind,
  };
}

export function quoteStatus(quote: ParsedQuote | null): string {
  if (!quote) return 'HTTP 200 已連線，但尚無成交價／參考價／昨收價資料';
  const labels: Record<QuoteKind, string> = {
    trade: '最新成交價', close: '收盤價', trial: '試撮價（非正式成交）',
    reference: '盤前參考價（尚無成交）', previous: '昨收價（尚無成交）',
  };
  return (labels[quote.kind] || '行情價格') + ' ' + quote.price;
}

export function httpError(status: number, code: string): string {
  const cause = status === 404 ? '路由或代號不存在'
    : status === 401 || status === 403 ? 'API Key 或行情權限異常'
    : status === 429 ? '超出 API 方案速率限制'
    : status === 400 ? '請求參數錯誤'
    : '請檢查網路或服務';
  return 'HTTP ' + status + ' [' + code + ']：' + cause;
}
