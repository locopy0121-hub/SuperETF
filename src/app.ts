import {
  REST_BASE,
  normalizeRestBase,
  normalizeSymbol,
  buildQuoteUrl,
  parseQuote,
  quoteStatus,
  httpError,
  type ParsedQuote,
} from './fugle-api.js';

export const VERSION = '1.3.1';

// ---------- Types ----------
export type AssetType = 'index' | 'etf' | 'stock';
export type SourceName = 'fuguo' | 'fuguo_waiting' | 'yahoo' | 'mock';
export type Side = 'buy' | 'sell';

export interface SeedQuote {
  code: string;
  name: string;
  type: AssetType;
  base: number;
  drift: number;
  yahoo?: string;
}

export interface Holding {
  code: string;
  name: string;
  qty: number;
  cost: number;
}

export interface Dividend {
  code: string;
  name: string;
  qty: number;
  amount: number;
  date: string;
}

export interface Txn {
  code: string;
  name: string;
  qty: number;
  price: number;
  date: string;
  side: Side;
}

export interface ApiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  symbols: Record<string, string>;
}

// ---------- API 設定（存於 localStorage，由「設置」tab 管理）----------
const LS_API = 'setf_api_config';
const API_DEFAULTS: Record<'fuguo', ApiConfig> = {
  fuguo: {
    enabled: false,
    baseUrl: REST_BASE,
    apiKey: '',
    symbols: {},
  },
};

function loadApiConfig(): typeof API_DEFAULTS {
  try {
    const raw = localStorage.getItem(LS_API);
    if (!raw) return structuredClone(API_DEFAULTS);
    const saved = JSON.parse(raw) as { fuguo?: Partial<ApiConfig> } | null;
    return {
      fuguo: {
        enabled: !!saved?.fuguo?.enabled,
        baseUrl: saved?.fuguo?.baseUrl || REST_BASE,
        apiKey: saved?.fuguo?.apiKey || '',
        symbols: saved?.fuguo?.symbols || {},
      },
    };
  } catch { return structuredClone(API_DEFAULTS); }
}

function saveApiConfig(cfg: typeof API_DEFAULTS): void {
  try { localStorage.setItem(LS_API, JSON.stringify(cfg)); } catch {}
}

let apiCfg = loadApiConfig();

// ---------- Seed data ----------
const SEED_QUOTES: SeedQuote[] = [
  { code: '^TWSE',  name: '加權指數',     type: 'index', base: 23500, drift: 0.001,  yahoo: '^TWSE'   },
  { code: '0050',   name: '元大50',       type: 'etf',   base: 18.35, drift: 0.0005, yahoo: '0050.TW'  },
  { code: '0056',   name: '國泰AP',       type: 'etf',   base: 31.50, drift: 0.0004, yahoo: '0056.TW'  },
  { code: '00859',  name: '元大S&P500',   type: 'etf',   base: 15.80, drift: 0.0006, yahoo: '00859.TW' },
  { code: '2884',   name: '聯電',         type: 'stock', base: 42.50, drift: 0.0008, yahoo: '2884.TW'  },
  { code: '2330',   name: '台積電',       type: 'stock', base: 1010,  drift: 0.0004, yahoo: '2330.TW'  },
  { code: '6605',   name: '台達電',       type: 'stock', base: 485,   drift: 0.0009, yahoo: '6605.TW'  },
];

const SEED_HOLDINGS: Holding[] = [
  { code: '0050', name: '元大50',  qty: 5000, cost: 18.02 },
  { code: '2330', name: '台積電',  qty: 50,   cost: 985.00 },
  { code: '0056', name: '國泰AP',  qty: 2000, cost: 30.80 },
];

const SEED_DIVIDENDS: Dividend[] = [
  { code: '0050', name: '元大50', qty: 5000, amount: 0.22, date: '2026-03-15' },
  { code: '2330', name: '台積電', qty: 50,   amount: 18.5, date: '2026-04-20' },
];

const SEED_TXNS: Txn[] = [
  { code: '0050', name: '元大50', qty: 5000, price: 18.02, date: '2026-01-10', side: 'buy' },
  { code: '2330', name: '台積電', qty: 50,   price: 985.00, date: '2026-01-12', side: 'buy' },
  { code: '0056', name: '國泰AP', qty: 2000, price: 30.80, date: '2026-02-05', side: 'buy' },
];

// ---------- State (localStorage-backed) ----------
const LS = { holdings: 'setf_holdings', dividends: 'setf_dividends', txns: 'setf_txns' } as const;
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function save(key: string, val: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

let holdings  = load<Holding[]>(LS.holdings, SEED_HOLDINGS);
let dividends = load<Dividend[]>(LS.dividends, SEED_DIVIDENDS);
let txns      = load<Txn[]>(LS.txns, SEED_TXNS);
save(LS.holdings, holdings); save(LS.dividends, dividends); save(LS.txns, txns);

// ---------- Quote ----------
export class Quote {
  readonly code: string;
  name: string;
  readonly type: AssetType;
  readonly yahooSymbol: string;
  open: number;
  price: number;
  readonly base: number;
  readonly drift: number;
  high: number;
  low: number;
  _hist: number[];
  hasReal: boolean;
  previousClose: number | null;
  priceKind: 'mock' | 'trade' | 'close' | 'trial' | 'reference' | 'previous';

  constructor({ code, name, type, base, drift, yahoo }: SeedQuote) {
    this.code = code;
    this.name = name;
    this.type = type;
    this.yahooSymbol = yahoo || (code.endsWith('.TW') ? code : code + '.TW');
    this.open = base * (1 + (Math.random() - 0.5) * 0.004);
    this.price = this.open;
    this.base = base;
    this.drift = drift;
    this.high = this.open;
    this.low = this.open;
    this._hist = Array.from({ length: 30 }, (_, i) => base * (1 + Math.sin(i / 5) * 0.01 + (Math.random() - 0.5) * 0.005));
    this.hasReal = false;
    this.previousClose = null;
    this.priceKind = 'mock';
  }

  tick(): void {
    const shock = (Math.random() - 0.5) * this.base * 0.002 + this.drift * this.base;
    this.price = Math.max(this.base * 0.5, this.price + shock);
    this.high = Math.max(this.high, this.price);
    this.low = Math.min(this.low, this.price);
    this._hist.push(this.price);
    if (this._hist.length > 60) this._hist.shift();
  }

  applyReal(price: number, open: number, details: Partial<ParsedQuote> & { kind?: string } = {}): void {
    if (!Number.isFinite(price) || price <= 0) return;
    this.price = price;
    this.hasReal = true;
    if (details.open != null && Number.isFinite(details.open) && details.open > 0) {
      this.open = details.open;
    }
    if (details.high != null && Number.isFinite(details.high)) {
      this.high = Math.max(this.high, details.high);
    }
    if (details.low != null && Number.isFinite(details.low)) {
      this.low = Math.min(this.low, details.low);
    }
    this._hist.push(this.price);
    if (this._hist.length > 60) this._hist.shift();
    this.priceKind = (details.kind as 'trade' | 'close' | 'trial' | 'reference' | 'previous' | undefined) || 'trade';
    this.previousClose = details.previousClose ?? this.previousClose;
    if (this.previousClose == null && this.open > 0) this.previousClose = this.open;
  }
}

// ---------- Market data source selection ----------
const quoteMap: Record<string, Quote> = {};
for (const s of SEED_QUOTES) quoteMap[s.code] = new Quote(s);
const quotes = Object.values(quoteMap);

// ---------- Yahoo Finance (备用来源) ----------
let yahooCache: Record<string, Partial<ParsedQuote> & { kind: string }> = {};
let yahooFetchTs = 0;
const YAHOO_TTL_MS = 15000;

export const SOURCE_LABELS: Record<SourceName, string> = {
  fuguo: '富果',
  fuguo_waiting: '富果（待存檔）',
  yahoo: 'Yahoo Finance',
  mock: '模擬數據',
};

interface MarketDataState {
  source: SourceName;
  lastFugleHttp200: boolean;
  lastFugleNoPrice: number;
  lastFugleError: string;
  lastFetchedAt: number;
}

export const MarketData = {
  source: 'mock' as SourceName,
  lastFugleHttp200: false,
  lastFugleNoPrice: 0,
  lastFugleError: '',
  lastFetchedAt: 0,
  async sync(): Promise<SourceName> {
    if (apiCfg.fuguo.enabled && apiCfg.fuguo.apiKey) {
      const ok = await fetchFromFuguo();
      if (ok) {
        this.source = 'fuguo';
        this.lastFetchedAt = Date.now();
        return this.source;
      }
      this.source = 'fuguo_waiting';
      this.lastFetchedAt = Date.now();
      await fallbackYahoo();
      this.lastFetchedAt = Date.now();
      return this.source;
    }
    await fallbackYahoo();
    this.lastFetchedAt = Date.now();
    return this.source;
  },
};

async function fetchFromFuguo(): Promise<boolean> {
  let anyOk = false;
  let noPrice = 0;
  for (const q of quotes) {
    try {
      const symbol = apiCfg.fuguo.symbols[q.code] || q.code;
      const url = buildQuoteUrl(apiCfg.fuguo.baseUrl, symbol);
      const r = await fetch(url, { headers: { 'X-API-KEY': apiCfg.fuguo.apiKey, Accept: 'application/json' } });
      if (!r.ok) {
        MarketData.lastFugleError = httpError(r.status, symbol);
        continue;
      }
      MarketData.lastFugleHttp200 = true;
      const data = await r.json();
      const parsed = parseQuote(data);
      if (parsed.price != null && Number.isFinite(parsed.price)) {
        q.applyReal(parsed.price, parsed.open ?? q.open, { kind: parsed.kind, previousClose: parsed.previousClose });
        anyOk = true;
      } else {
        noPrice++;
      }
    } catch { /* network/CORS — 保留現值 */ }
  }
  MarketData.lastFugleNoPrice = noPrice;
  return anyOk;
}

async function fallbackYahoo(): Promise<void> {
  MarketData.source = 'yahoo';
  if (Date.now() - yahooFetchTs < YAHOO_TTL_MS) return;
  yahooFetchTs = Date.now();
  const codes = quotes.map(q => q.yahooSymbol);
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(codes[0]) + '?interval=1d&range=5d');
    if (!r.ok) return;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const meta = res?.meta;
    if (!meta) return;
    const q = quoteMap[codes[0] === '^TWSE' ? '^TWSE' : codes[0].replace('.TW', '')];
    if (q) {
      const close = meta.regularMarketPrice;
      if (Number.isFinite(close)) {
        q.applyReal(close, meta.open ?? q.open, { kind: 'close', previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null });
      }
    }
  } catch { /* keep mock */ }
}

// ---------- Helpers ----------
function fmt(n: number, digits = 2): string {
  return n.toLocaleString('zh-TW', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(now: number, ref: number): number {
  return ref !== 0 ? ((now - ref) / ref) * 100 : 0;
}
function signClass(v: number): string {
  return v > 0 ? 'up' : v < 0 ? 'down' : '';
}
function signFmt(v: number, digits = 2): string {
  return (v > 0 ? '+' : '') + fmt(v, digits);
}

// ---------- Live tab ----------
function renderLive(): void {
  const el = document.getElementById('live-table') as HTMLTableSectionElement | null;
  if (!el) return;
  const src = MarketData.source;
  const srcLabel = SOURCE_LABELS[src] || src;
  const fugleNote = src === 'fuguo_waiting' ? '；富果暫未回傳，已回退 ' + (MarketData.lastFugleError || 'Yahoo') : '';
  el.innerHTML = `
    <thead>
      <tr><th>代號</th><th>名稱</th><th>類別</th><th>現價</th><th>漲跌幅</th><th>來源</th></tr>
    </thead>
    <tbody>
      ${quotes.map(q => {
        const chg = q.previousClose != null ? q.price - q.previousClose : q.price - q.open;
        const chgPct = q.previousClose != null ? pct(q.price, q.previousClose) : pct(q.price, q.open);
        const kind = q.priceKind === 'mock' ? '模擬' : q.priceKind === 'close' ? '收盤' : '即時';
        return `<tr>
          <td class="mono">${q.code}</td>
          <td>${q.name}</td>
          <td>${q.type === 'index' ? '指數' : q.type === 'etf' ? 'ETF' : '個股'}</td>
          <td class="num ${signClass(chg)}">${fmt(q.price)}</td>
          <td class="num ${signClass(chgPct)}">${signFmt(chgPct)}%</td>
          <td><span class="src-badge ${src}">${srcLabel}（${kind}）</span></td>
        </tr>`;
      }).join('')}
    </tbody>`;
  const status = document.getElementById('live-status');
  if (status) status.textContent = `即時報價來源：${srcLabel}（更新於 ${new Date().toLocaleTimeString('zh-TW')}）` + fugleNote;
}

// ---------- PnL tab ----------
function renderPnl(): void {
  const el = document.getElementById('pnl-table') as HTMLTableSectionElement | null;
  if (!el) return;
  const rows = holdings.map(h => {
    const q = quoteMap[h.code];
    const cur = q ? q.price : h.cost;
    const mv = h.qty * cur;
    const costTotal = h.qty * h.cost;
    const pnl = mv - costTotal;
    const pnlPct = pct(mv, costTotal);
    return { ...h, cur, mv, costTotal, pnl, pnlPct };
  });
  const totalMv = rows.reduce((s, r) => s + r.mv, 0);
  const totalCost = rows.reduce((s, r) => s + r.costTotal, 0);
  const totalPnl = totalMv - totalCost;
  el.innerHTML = `
    <thead>
      <tr><th>代號</th><th>名稱</th><th>持股</th><th>成本</th><th>現價</th><th>市值</th><th>損益額</th><th>損益率</th></tr>
    </thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td class="mono">${r.code}</td>
        <td>${r.name}</td>
        <td class="num">${r.qty.toLocaleString('zh-TW')}</td>
        <td class="num">${fmt(r.cost)}</td>
        <td class="num">${fmt(r.cur)}</td>
        <td class="num">${fmt(r.mv, 0)}</td>
        <td class="num ${signClass(r.pnl)}">${signFmt(r.pnl, 0)}</td>
        <td class="num ${signClass(r.pnlPct)}">${signFmt(r.pnlPct)}%</td>
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="5">合計</td>
        <td class="num">${fmt(totalMv, 0)}</td>
        <td class="num ${signClass(totalPnl)}">${signFmt(totalPnl, 0)}</td>
        <td class="num ${signClass(pct(totalMv, totalCost))}">${signFmt(pct(totalMv, totalCost))}%</td>
      </tr>
    </tfoot>`;
}

// ---------- Portfolio tab ----------
function renderPortfolio(): void {
  const el = document.getElementById('portfolio-list') as HTMLElement | null;
  if (!el) return;
  const totalMv = holdings.reduce((s, h) => s + h.qty * (quoteMap[h.code]?.price ?? h.cost), 0);
  el.innerHTML = holdings.map(h => {
    const q = quoteMap[h.code];
    const mv = h.qty * (q?.price ?? h.cost);
    const weight = totalMv > 0 ? (mv / totalMv) * 100 : 0;
    return `<div class="port-item">
      <div class="port-head">
        <span class="mono">${h.code}</span>
        <span>${h.name}</span>
        <span class="num">${weight.toFixed(1)}%</span>
      </div>
      <div class="port-bar"><div style="width:${weight}%"></div></div>
      <div class="port-meta">持股 ${h.qty.toLocaleString('zh-TW')} ｜ 市值 ${fmt(mv, 0)} ｜ 成本 ${fmt(h.cost)}</div>
    </div>`;
  }).join('');
}

// ---------- Dividends tab ----------
function renderDividends(): void {
  const el = document.getElementById('dividend-list') as HTMLElement | null;
  if (!el) return;
  const total = dividends.reduce((s, d) => s + d.qty * d.amount, 0);
  el.innerHTML = `
    <div class="div-summary">本年度預估領息總額：<strong class="num">${fmt(total, 0)} 元</strong></div>
    <table class="mini-table">
      <thead><tr><th>代號</th><th>名稱</th><th>持股</th><th>每股股利</th><th>預估領息</th><th>除息日</th></tr></thead>
      <tbody>
        ${dividends.map(d => `<tr>
          <td class="mono">${d.code}</td>
          <td>${d.name}</td>
          <td class="num">${d.qty.toLocaleString('zh-TW')}</td>
          <td class="num">${fmt(d.amount)}</td>
          <td class="num">${fmt(d.qty * d.amount, 0)}</td>
          <td>${d.date}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ---------- Analysis tab ----------
function drawAnalysis(): void {
  const canvas = document.getElementById('analysis-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const q = quoteMap['0050'];
  if (!q) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const data = q._hist;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  ctx.beginPath();
  ctx.strokeStyle = '#4f8cff';
  ctx.lineWidth = 2;
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 20) - 10;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = '#888';
  ctx.font = '11px monospace';
  ctx.fillText('0050 近 ' + data.length + ' 筆走勢（模擬）', 8, h - 4);
}

// ---------- Tab switching ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const tabId = tab.dataset.tab as string;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('tab-' + tabId);
    if (panel) panel.classList.add('active');
    if (tabId === 'analysis') drawAnalysis();
  });
});

// ---------- 版本同步：讓 UI 的版本字樣全部由 VERSION 單一來源驅動 ----------
function applyVersionToDom(): void {
  const sub = document.getElementById('version-sub');
  if (sub) sub.textContent = '台股資產管理 v' + VERSION;
  const about = document.getElementById('version-about');
  if (about) about.textContent = 'v' + VERSION;
  const footer = document.getElementById('version-footer');
  if (footer) footer.innerHTML = 'SuperETF v' + VERSION + ' · 個人開發版本 · 主：富果API / 備：Yahoo Finance / 離線：模擬數據';
}

// ---------- Settings tab — API 設定存取 ----------
function loadSettingsForm(): void {
  const f = apiCfg.fuguo;
  const setVal = (id: string, val: string | number | boolean | undefined | null) => {
    const el = document.getElementById(id);
    if (el) (el as HTMLInputElement | HTMLTextAreaElement).value = val == null ? '' : String(val);
  };
  setVal('cfg-fuguo-baseurl', (() => { try { return normalizeRestBase(f.baseUrl); } catch { return f.baseUrl; } })());
  setVal('cfg-fuguo-key', f.apiKey);
  setVal('cfg-fuguo-symbols', Object.keys(f.symbols).length ? JSON.stringify(f.symbols, null, 2) : '');
  const chk = document.getElementById('cfg-fuguo-enabled') as HTMLInputElement | null;
  if (chk) chk.checked = f.enabled;
  updateSourcePriorityBadges();
}

function updateSourcePriorityBadges(): void {
  const fuBadge = document.getElementById('src-prio-fuguo');
  if (!fuBadge) return;
  if (apiCfg.fuguo.enabled && apiCfg.fuguo.apiKey) {
    fuBadge.textContent = '已設定';
    fuBadge.className = 'source-badge fuguo';
  } else {
    const draft = (document.getElementById('cfg-fuguo-enabled') as HTMLInputElement)?.checked &&
      (document.getElementById('cfg-fuguo-key') as HTMLInputElement)?.value.trim();
    fuBadge.textContent = draft ? '待儲存' : '未設定';
    fuBadge.className = 'source-badge mock';
  }
}

function parseSymbolsJson(raw: string): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error();
    for (const [code, symbol] of Object.entries(obj)) {
      if (!quoteMap[code] || typeof symbol !== 'string') throw new Error();
      normalizeSymbol(symbol);
    }
    return obj as Record<string, string>;
  } catch {
    throw new Error('代號對應格式錯誤，請使用 JSON 物件，例如 {"0050":"TWSE:0050"}');
  }
}

function setFeedback(msg: string, ok: boolean): void {
  const el = document.getElementById('cfg-feedback')!;
  el.textContent = msg;
  el.className = 'settings-feedback ' + (ok ? 'ok' : 'err');
}

document.getElementById('cfg-save')!.addEventListener('click', () => {
  const f = apiCfg.fuguo;
  const enabled = (document.getElementById('cfg-fuguo-enabled') as HTMLInputElement).checked;
  let baseUrl: string;
  try { baseUrl = normalizeRestBase((document.getElementById('cfg-fuguo-baseurl') as HTMLInputElement).value); }
  catch (e) { setFeedback('Base URL 錯誤：' + (e as Error).message, false); return; }
  const apiKey = (document.getElementById('cfg-fuguo-key') as HTMLInputElement).value.trim();
  if (enabled && !apiKey) { setFeedback('啟用富果 API 前請輸入 API Key', false); return; }
  let symbols: Record<string, string>;
  try {
    symbols = parseSymbolsJson((document.getElementById('cfg-fuguo-symbols') as HTMLTextAreaElement).value);
  } catch (e) {
    setFeedback((e as Error).message, false);
    return;
  }

  apiCfg = { fuguo: { enabled, baseUrl, apiKey, symbols } };
  saveApiConfig(apiCfg);

  const summary = enabled && baseUrl
    ? '已保存：富果API 已啟用，即時行情將優先使用富果來源'
    : '已保存：富果API 未啟用，即時行情將使用 Yahoo Finance';
  setFeedback(summary, true);
  updateSourcePriorityBadges();
  MarketData.sync().then(src => {
    const error = enabled && src !== 'fuguo' && !MarketData.lastFugleHttp200
      ? MarketData.lastFugleError : '';
    const idle = enabled && MarketData.lastFugleNoPrice > 0 ? '；部分代號 HTTP 200 但盤前尚無價格' : '';
    setFeedback(summary + '（目前來源：' + (SOURCE_LABELS[src] || src) + '）' +
      idle + (error ? '；富果診斷：' + error : ''), !error);
  });
});

document.getElementById('cfg-test')!.addEventListener('click', async () => {
  const input = (document.getElementById('cfg-fuguo-baseurl') as HTMLInputElement).value;
  const key = (document.getElementById('cfg-fuguo-key') as HTMLInputElement).value.trim();
  if (!key) { setFeedback('請先填入 API Key', false); return; }
  let url: string;
  try { url = buildQuoteUrl(input, '0050'); }
  catch (e) { setFeedback('❌ ' + (e as Error).message, false); return; }
  setFeedback('測試中：富果 0050 標準報價路由…', true);
  try {
    const r = await fetch(url, { headers: { 'X-API-KEY': key, Accept: 'application/json' } });
    if (!r.ok) {
      setFeedback('❌ ' + httpError(r.status, '0050') + '；URL：' + url, false);
      return;
    }
    const quote = parseQuote(await r.json());
    const pending = apiCfg.fuguo.enabled ? '' : '；請按「保存設定」啟用自動更新';
    setFeedback('✅ 富果 API v1.0 ' + quoteStatus(quote) + pending, true);
    updateSourcePriorityBadges();
  } catch (e) {
    setFeedback('❌ 網路或 CORS 問題：' + (e as Error).message, false);
  }
});

// ---------- Tick loop（離線模擬時啟用；有真實資料時跳過 random-walk） ----------
setInterval(() => {
  if (MarketData.source === 'mock') {
    quotes.forEach(q => q.tick());
  }
  if (document.getElementById('tab-live')?.classList.contains('active')) renderLive();
  if (document.getElementById('tab-pnl')?.classList.contains('active')) renderPnl();
  if (document.getElementById('tab-portfolio')?.classList.contains('active')) renderPortfolio();
  if (document.getElementById('tab-analysis')?.classList.contains('active')) drawAnalysis();
}, 2000);

// ---------- Init ----------
loadSettingsForm();
applyVersionToDom();
renderLive(); renderPnl(); renderPortfolio(); renderDividends();
console.log('SuperETF v' + VERSION);
