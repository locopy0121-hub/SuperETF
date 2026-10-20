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

export const VERSION = '1.3.0';

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
    if (!this.hasReal) {
      this._hist = [];
      this.high = details.high ?? price;
      this.low = details.low ?? price;
    } else {
      this.high = details.high ?? Math.max(this.high, price);
      this.low = details.low ?? Math.min(this.low, price);
    }
    if (Number.isFinite(open) && open > 0) this.open = open;
    this.price = price;
    this.previousClose = details.previousClose ?? this.previousClose;
    this.priceKind = (details.kind as Quote['priceKind']) ?? 'trade';
    this.hasReal = true;
    this._hist.push(price);
    if (this._hist.length > 60) this._hist.shift();
  }

  get pctChg(): number {
    const base = this.previousClose && this.previousClose > 0 ? this.previousClose : this.open;
    return base > 0 ? (this.price - base) / base : 0;
  }
}

export const quotes: Quote[] = SEED_QUOTES.map(q => new Quote(q));
export const quoteMap: Record<string, Quote> = Object.fromEntries(quotes.map(q => [q.code, q]));

function fmt(n: number, digits = 2): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pctFmt(p: number): string {
  return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%';
}
function cls(p: number): 'up' | 'down' | 'flat' {
  return p > 0.0005 ? 'up' : p < -0.0005 ? 'down' : 'flat';
}

// ============================================================
// MarketData service — 富果API 主 / Yahoo 備 / 離線模擬兜底
// ============================================================
const SOURCE_LABELS: Record<SourceName, string> = {
  fuguo: '來源：富果 API',
  fuguo_waiting: '富果 API 已連線（尚無行情）',
  yahoo: '來源：Yahoo Finance',
  mock: '模擬數據（離線）',
};

export interface MarketData {
  source: SourceName;
  lastUpdated: number;
  lastFugleError: string;
  lastFugleHttp200: number;
  lastFugleNoPrice: number;
  setSource(name: SourceName): void;
  fetchFuguo(): Promise<number>;
  fetchYahoo(): Promise<number>;
  sync(): Promise<SourceName>;
}

export const MarketData: MarketData = {
  source: 'mock',
  lastUpdated: 0,
  lastFugleError: '',
  lastFugleHttp200: 0,
  lastFugleNoPrice: 0,

  setSource(name: SourceName) {
    this.source = name;
    const badge = document.getElementById('data-source-badge');
    const label = document.getElementById('last-updated');
    if (badge) {
      badge.textContent = SOURCE_LABELS[name] || name;
      badge.className = 'source-badge ' + name;
    }
    if (label && this.lastUpdated) {
      label.textContent = '更新於 ' + new Date(this.lastUpdated).toLocaleTimeString('zh-TW', { hour12: false });
    }
    updateSourcePriorityBadges();
  },

  async fetchFuguo(): Promise<number> {
    const f = apiCfg.fuguo;
    if (!f.enabled || !f.apiKey) return 0;
    this.lastFugleError = '';
    this.lastFugleHttp200 = 0;
    this.lastFugleNoPrice = 0;
    let base: string;
    try { base = normalizeRestBase(f.baseUrl); }
    catch (e) { this.lastFugleError = (e as Error).message; return 0; }

    const responses = await Promise.all(quotes.map(async (q) => {
      const symbol = f.symbols[q.code] || q.code;
      try {
        const url = buildQuoteUrl(base, symbol);
        const r = await fetch(url, {
          headers: { 'X-API-KEY': f.apiKey, Accept: 'application/json' },
        });
        if (!r.ok) throw new Error(httpError(r.status, q.code));
        const data = (await r.json()) as unknown;
        const value = parseQuote(data);
        return { q, data, value };
      } catch (e) {
        if (!this.lastFugleError) this.lastFugleError = (e as Error).message;
        console.warn('[SuperETF] 富果報價失敗：' + q.code + '：' + (e as Error).message);
        return null;
      }
    }));
    this.lastFugleHttp200 = responses.filter(Boolean).length;
    const valid = responses.filter((item): item is NonNullable<typeof item> && NonNullable<typeof item>['value'] is ParsedQuote => item != null && item.value != null);
    this.lastFugleNoPrice = this.lastFugleHttp200 - valid.length;
    for (const { q, data, value } of valid) {
      q.applyReal(value.price, value.open, value);
      const record = (data as { data?: Record<string, unknown> }).data &&
        typeof (data as { data?: Record<string, unknown> }).data === 'object'
        ? (data as { data?: Record<string, unknown> }).data!
        : data as Record<string, unknown>;
      if (typeof record.name === 'string' && record.name) q.name = record.name;
    }
    return valid.length;
  },

  async fetchYahoo(): Promise<number> {
    const responses = await Promise.all(quotes.map(async (q) => {
      try {
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(q.yahooSymbol) + '?interval=1d&range=1d';
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) return null;
        const json = (await r.json()) as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } };
        const meta = json.chart?.result?.[0]?.meta;
        const price = Number(meta?.regularMarketPrice ?? meta?.chartPreviousClose);
        if (!Number.isFinite(price) || price <= 0) return null;
        return {
          q,
          price,
          open: Number(meta?.regularMarketOpen ?? meta?.chartPreviousClose) || price,
        };
      } catch (e) {
        console.warn('[SuperETF] Yahoo 備援 ' + q.code + '：' + (e as Error).message);
        return null;
      }
    }));
    const valid = responses.filter(Boolean) as Array<{ q: Quote; price: number; open: number }>;
    valid.forEach(v => v.q.applyReal(v.price, v.open));
    return valid.length;
  },

  async sync(): Promise<SourceName> {
    const fu = await this.fetchFuguo();
    if (fu > 0) { this.lastUpdated = Date.now(); this.setSource('fuguo'); return 'fuguo'; }
    const yh = await this.fetchYahoo();
    if (yh > 0) { this.lastUpdated = Date.now(); this.setSource('yahoo'); return 'yahoo'; }
    if (this.lastFugleHttp200) {
      this.lastUpdated = Date.now(); this.setSource('fuguo_waiting'); return 'fuguo_waiting';
    }
    this.setSource('mock');
    return 'mock';
  },
};

let marketSyncPending = false;
async function marketLoop(): Promise<void> {
  if (marketSyncPending) return;
  marketSyncPending = true;
  try { await MarketData.sync(); renderLive(); }
  finally { marketSyncPending = false; }
}
void marketLoop();
setInterval(marketLoop, 30000);

// ---------- Session badge ----------
function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= 570 && t < 840;
}
function updateBadge(): void {
  const el = document.getElementById('session-badge');
  if (!el) return;
  if (isMarketOpen()) { el.textContent = '開盤中'; el.className = 'session-badge open'; }
  else { el.textContent = '盤前 / 盤後'; el.className = 'session-badge closed'; }
}
setInterval(updateBadge, 30000);
updateBadge();

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('tab-' + (btn as HTMLButtonElement).dataset.tab!);
    panel?.classList.add('active');
    if ((btn as HTMLButtonElement).dataset.tab === 'analysis') drawAnalysis();
    if ((btn as HTMLButtonElement).dataset.tab === 'settings') loadSettingsForm();
  });
});

// ---------- Live grid ----------
let liveFilter = 'all';
document.querySelectorAll('.chip').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    liveFilter = (c as HTMLButtonElement).dataset.type!;
    renderLive();
  });
});

function renderLive(): void {
  const grid = document.getElementById('live-grid');
  if (!grid) return;
  const list = quotes.filter(q => liveFilter === 'all' || q.type === liveFilter);
  grid.innerHTML = list.map(q => {
    const p = q.pctChg;
    const typeLabel = q.type === 'index' ? '指數' : q.type === 'etf' ? 'ETF' : '個股';
    const kindLabel = q.hasReal
      ? ({ reference: '參考', previous: '昨收', trial: '試撮' } as Record<string, string>)[q.priceKind] || ''
      : '';
    return `<div class="live-card">
      <div class="code"><span>${q.code.replace('^', '')}</span><span>${typeLabel}</span></div>
      <div class="name">${q.name}</div>
      <div class="price ${cls(p)}">${fmt(q.price)}${kindLabel ? ' <small style="font-size:11px;color:var(--muted)">' + kindLabel + '</small>' : ''}</div>
      <div class="chg ${cls(p)}">${pctFmt(p)} <span style="color:var(--muted);font-size:11px">開 ${fmt(q.open)}</span></div>
    </div>`;
  }).join('');
}

// ---------- PnL wall ----------
function renderPnl(): void {
  const summary = document.getElementById('pnl-summary');
  const wall = document.getElementById('pnl-wall');
  if (!summary || !wall) return;
  let totalCost = 0, totalValue = 0;
  const tiles = holdings.map(h => {
    const q = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const pnl = (price - h.cost) * h.qty;
    const pnlPct = h.cost ? (price - h.cost) / h.cost : 0;
    const cost = h.cost * h.qty;
    const value = price * h.qty;
    totalCost += cost;
    totalValue += value;
    return { h, price, pnl, pnlPct, cost, value };
  });
  const totalPnl = totalValue - totalCost;
  const totalPct = totalCost ? totalPnl / totalCost : 0;

  summary.innerHTML = `
    <div class="pnl-box"><div class="label">總市值</div><div class="value">NT$ ${fmt(totalValue)}</div></div>
    <div class="pnl-box"><div class="label">總成本</div><div class="value">NT$ ${fmt(totalCost)}</div></div>
    <div class="pnl-box"><div class="label">總損益</div><div class="value ${cls(totalPct)}">${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)}</div></div>
    <div class="pnl-box"><div class="label">總報酬率</div><div class="value ${cls(totalPct)}">${pctFmt(totalPct)}</div></div>`;

  wall.innerHTML = tiles.map(({ h, price, pnl, pnlPct }) => {
    const sparkCanvas = `<canvas class="spark" data-code="${h.code}" width="200" height="34"></canvas>`;
    return `<div class="pnl-tile">
      <div class="head"><span>${h.code} ${h.name}</span><span>${h.qty} 股</span></div>
      <div class="pnl ${cls(pnlPct)}">${pnl >= 0 ? '+' : ''}${fmt(pnl)}（${pctFmt(pnlPct)}）</div>
      ${sparkCanvas}
      <div style="font-size:11px;color:var(--muted)">現價 ${fmt(price)} · 成本 ${fmt(h.cost)}</div>
    </div>`;
  }).join('');

  wall.querySelectorAll('.spark').forEach(cv => {
    const q = quoteMap[(cv as HTMLElement).dataset.code!];
    if (!q) return;
    const ctx = (cv as HTMLCanvasElement).getContext('2d');
    if (!ctx) return;
    const data = q._hist.slice(-30);
    if (!data.length) return;
    const w = (cv as HTMLCanvasElement).width, h2 = (cv as HTMLCanvasElement).height;
    ctx.clearRect(0, 0, w, h2);
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    ctx.strokeStyle = q.pctChg >= 0 ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h2 - 2 - ((v - min) / range) * (h2 - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

// ---------- Portfolio ----------
document.getElementById('btn-add-holding')!.addEventListener('click', () => {
  document.getElementById('add-holding-form')!.classList.toggle('hidden');
});
document.getElementById('fh-cancel')!.addEventListener('click', () => {
  document.getElementById('add-holding-form')!.classList.add('hidden');
});
document.getElementById('fh-save')!.addEventListener('click', () => {
  const code = (document.getElementById('fh-code') as HTMLInputElement).value.trim();
  const name = (document.getElementById('fh-name') as HTMLInputElement).value.trim();
  const qty = parseInt((document.getElementById('fh-qty') as HTMLInputElement).value) || 0;
  const cost = parseFloat((document.getElementById('fh-cost') as HTMLInputElement).value) || 0;
  if (!code || !qty) return alert('請填入代號與股數');
  holdings.push({ code, name: name || code, qty, cost });
  save(LS.holdings, holdings);
  document.getElementById('add-holding-form')!.classList.add('hidden');
  ['fh-code', 'fh-name', 'fh-qty', 'fh-cost'].forEach(id => (document.getElementById(id) as HTMLInputElement).value = '');
  renderPortfolio(); renderPnl();
});

function renderPortfolio(): void {
  const body = document.getElementById('portfolio-body');
  if (!body) return;
  const totalValue = holdings.reduce((s, h) => s + (quoteMap[h.code] ? quoteMap[h.code]!.price : h.cost) * h.qty, 0);
  body.innerHTML = holdings.map((h, i) => {
    const q = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const value = price * h.qty;
    const cost = h.cost * h.qty;
    const pnl = value - cost;
    const pct = totalValue ? value / totalValue : 0;
    return `<tr>
      <td><strong>${h.code}</strong></td>
      <td>${h.name}</td>
      <td>${h.qty.toLocaleString()}</td>
      <td>${fmt(h.cost)}</td>
      <td class="${cls(q ? q.pctChg : 0)}">${fmt(price)}</td>
      <td class="${cls(pnl)}">${pnl >= 0 ? '+' : ''}${fmt(pnl)}</td>
      <td>${(pct * 100).toFixed(1)}%</td>
      <td><button class="del-btn" data-i="${i}" title="移除">×</button></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.del-btn').forEach(b => {
    b.addEventListener('click', () => {
      const i = parseInt((b as HTMLButtonElement).dataset.i!);
      holdings.splice(i, 1);
      save(LS.holdings, holdings);
      renderPortfolio(); renderPnl();
    });
  });
  renderTransactions();
}

function renderTransactions(): void {
  const txnEl = document.getElementById('transactions');
  if (!txnEl) return;
  txnEl.innerHTML = `<h3>交易紀錄（最新在前）</h3><div class="txn-list">` +
    [...txns].reverse().slice(0, 10).map(t => `
      <div class="txn-item">
        <span class="${t.side === 'buy' ? 'up' : 'down'}">${t.side === 'buy' ? '買入' : '賣出'} ${t.code} ${Math.abs(t.qty)} 股 @ ${fmt(t.price)}</span>
        <span class="date">${t.date}</span>
      </div>`).join('') + '</div>';
}

// ---------- Dividends ----------
document.getElementById('btn-add-dividend')!.addEventListener('click', () => {
  document.getElementById('add-dividend-form')!.classList.toggle('hidden');
});
document.getElementById('fd-cancel')!.addEventListener('click', () => {
  document.getElementById('add-dividend-form')!.classList.add('hidden');
});
document.getElementById('fd-save')!.addEventListener('click', () => {
  const code = (document.getElementById('fd-code') as HTMLInputElement).value.trim();
  const name = (document.getElementById('fd-name') as HTMLInputElement).value.trim();
  const qty = parseInt((document.getElementById('fd-qty') as HTMLInputElement).value) || 0;
  const amount = parseFloat((document.getElementById('fd-amount') as HTMLInputElement).value) || 0;
  const date = (document.getElementById('fd-date') as HTMLInputElement).value || new Date().toISOString().slice(0, 10);
  if (!code || !qty) return alert('請填入代號與股數');
  dividends.push({ code, name: name || code, qty, amount, date });
  save(LS.dividends, dividends);
  document.getElementById('add-dividend-form')!.classList.add('hidden');
  ['fd-code', 'fd-name', 'fd-qty', 'fd-amount', 'fd-date'].forEach(id => (document.getElementById(id) as HTMLInputElement).value = '');
  renderDividends(); renderPnl();
});

function renderDividends(): void {
  const year = new Date().getFullYear().toString();
  const list = dividends.filter(d => d.date.startsWith(year));
  const total = list.reduce((s, d) => s + d.qty * d.amount, 0);
  const yieldPct = holdings.length ? total / holdings.reduce((s, h) => s + h.cost * h.qty, 0) : 0;
  document.getElementById('dividend-summary')!.innerHTML = `
    <div class="pnl-box"><div class="label">本年度股息總額</div><div class="value up">NT$ ${fmt(total)}</div></div>
    <div class="pnl-box"><div class="label">股息率（對成本）</div><div class="value">${(yieldPct * 100).toFixed(2)}%</div></div>`;
  const el = document.getElementById('dividend-list')!;
  el.innerHTML = dividends.length
    ? dividends.slice().reverse().map(d => `
      <div class="div-item">
        <span><strong>${d.code}</strong> ${d.name} · ${d.qty} 股 × ${fmt(d.amount)} <span style="color:var(--muted);font-size:12px">${d.date}</span></span>
        <span class="total">+${fmt(d.qty * d.amount)}</span>
      </div>`).join('')
    : '<div style="color:var(--muted);padding:20px;text-align:center">尚無股息紀錄</div>';
}

// ---------- Analysis ----------
function drawAnalysis(): void {
  const canvas = document.getElementById('analysis-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const t = quoteMap['^TWSE'];
  if (!t) return;
  const data = t._hist;
  if (!data.length) return;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const up = data[data.length - 1]! >= data[0]!;

  ctx.strokeStyle = '#2a3042'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (h - 40) * i / 4 + 20;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 20 - ((v - min) / range) * (h - 40);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const vwap = data.reduce((s, v) => s + v, 0) / data.length;
  const dayRng = (t.high - t.low) / t.open;
  document.getElementById('analysis-metrics')!.innerHTML = `
    <div class="metric"><div class="label">加權開盤</div><div class="value">${fmt(t.open)}</div></div>
    <div class="metric"><div class="label">現價</div><div class="value ${cls(t.pctChg)}">${fmt(t.price)}</div></div>
    <div class="metric"><div class="label">日區間</div><div class="value">${fmt(t.low)} – ${fmt(t.high)}</div></div>
    <div class="metric"><div class="label">VWAP</div><div class="value">${fmt(vwap)}</div></div>
    <div class="metric"><div class="label">日波動度</div><div class="value">${(dayRng * 100).toFixed(2)}%</div></div>`;

  const srcLabel = SOURCE_LABELS[MarketData.source] || '模擬數據';
  const h0050 = holdings.find(h => h.code === '0050');
  document.getElementById('analysis-notes')!.innerHTML =
    `<strong style="color:var(--text)">市場解讀</strong>（${srcLabel}）<br>` +
    `• 加權指數開盤 <b>${fmt(t.open)}</b>，現價 <b class="${cls(t.pctChg)}">${fmt(t.price)}</b>（${pctFmt(t.pctChg)}）。<br>` +
    `• 日內波動區間 ${fmt(t.low)}–${fmt(t.high)}，區間幅度 ${(dayRng * 100).toFixed(2)}%。<br>` +
    (h0050 ? `• 0050 持倉 ${h0050.qty.toLocaleString()} 股，成本 ${fmt(h0050.cost)}。` : '');
}

// ============================================================
// Settings tab — API 設定存取
// ============================================================
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
renderLive(); renderPnl(); renderPortfolio(); renderDividends();
console.log('SuperETF v' + VERSION);
