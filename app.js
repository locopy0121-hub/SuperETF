(() => {
'use strict';

const VERSION = '1.2.0';

// ---------- API 設定（存於 localStorage，由「設置」tab 管理）----------
const LS_API  = 'setf_api_config_v2';
const API_DEFAULTS = {
  fugle: {
    enabled: false,
    restUrl: '',
    wsUrl: '',
    apiKey: '',
    wsAutoFallback: true,
  },
};
function loadApiConfig() {
  try {
    const raw = localStorage.getItem(LS_API) || localStorage.getItem('setf_api_config');
    if (!raw) return structuredClone(API_DEFAULTS);
    const saved = JSON.parse(raw);
    // 相容舊版 setf_api_config（fuguo 欄位）
    const src = saved?.fugle ?? saved?.fuguo ?? {};
    return {
      fugle: {
        enabled:        !!src.enabled,
        restUrl:        src.restUrl   || src.baseUrl || '',
        wsUrl:          src.wsUrl     || '',
        apiKey:         src.apiKey    || '',
        wsAutoFallback: src.wsAutoFallback !== undefined ? !!src.wsAutoFallback : true,
      },
    };
  } catch { return structuredClone(API_DEFAULTS); }
}
function saveApiConfig(cfg) {
  try { localStorage.setItem(LS_API, JSON.stringify(cfg)); } catch {}
}
let apiCfg = loadApiConfig();

// 富果 API 預設端點
const FUGLE_REST_DEFAULT = 'https://api.fugle.tw/marketdata/v1.0';
const FUGLE_WS_DEFAULT   = 'wss://api.fugle.tw/marketdata/v1.0/stock/streaming';

// ---------- Seed data ----------
// code: 系統內部代號；fugleSymbol: 富果代碼（^TSE=加權指數）；yahoo: Yahoo Finance 代號
const SEED_QUOTES = [
  { code: '^TSE',  name: '加權指數',     type: 'index', base: 23500, drift: 0.001,  fugleSymbol: '^TSE',  yahoo: '^TWSE'   },
  { code: '0050',  name: '元大50',       type: 'etf',   base: 18.35, drift: 0.0005, fugleSymbol: '0050',  yahoo: '0050.TW'  },
  { code: '0056',  name: '國泰AP',       type: 'etf',   base: 31.50, drift: 0.0004, fugleSymbol: '0056',  yahoo: '0056.TW'  },
  { code: '00859', name: '元大S&P500',   type: 'etf',   base: 15.80, drift: 0.0006, fugleSymbol: '00859', yahoo: '00859.TW' },
  { code: '2884',  name: '聯電',         type: 'stock', base: 42.50, drift: 0.0008, fugleSymbol: '2884',  yahoo: '2884.TW'  },
  { code: '2330',  name: '台積電',       type: 'stock', base: 1010,  drift: 0.0004, fugleSymbol: '2330',  yahoo: '2330.TW'  },
  { code: '6605',  name: '台達電',       type: 'stock', base: 485,   drift: 0.0009, fugleSymbol: '6605',  yahoo: '6605.TW'  },
];

const SEED_HOLDINGS = [
  { code: '0050', name: '元大50',  qty: 5000, cost: 18.02 },
  { code: '2330', name: '台積電',  qty: 50,   cost: 985.00 },
  { code: '0056', name: '國泰AP',  qty: 2000, cost: 30.80 },
];

const SEED_DIVIDENDS = [
  { code: '0050', name: '元大50', qty: 5000, amount: 0.22, date: '2026-03-15' },
  { code: '2330', name: '台積電', qty: 50,   amount: 18.5, date: '2026-04-20' },
];

const SEED_TXNS = [
  { code: '0050', name: '元大50', qty: +5000, price: 18.02, date: '2026-01-10', side: 'buy' },
  { code: '2330', name: '台積電', qty: +50,   price: 985.00, date: '2026-01-12', side: 'buy' },
  { code: '0056', name: '國泰AP', qty: +2000, price: 30.80, date: '2026-02-05', side: 'buy' },
];

// ---------- State (localStorage-backed) ----------
const LS = { holdings: 'setf_holdings', dividends: 'setf_dividends', txns: 'setf_txns' };
function load(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

let holdings  = load(LS.holdings,  SEED_HOLDINGS);
let dividends = load(LS.dividends, SEED_DIVIDENDS);
let txns      = load(LS.txns,      SEED_TXNS);
save(LS.holdings, holdings); save(LS.dividends, dividends); save(LS.txns, txns);

// ---------- Quote ----------
class Quote {
  constructor({ code, name, type, base, drift, yahoo, fugleSymbol }) {
    this.code = code; this.name = name; this.type = type;
    this.yahooSymbol = yahoo || (code.endsWith('.TW') ? code : code + '.TW');
    this.fugleSymbol = fugleSymbol || code;
    this.open = base * (1 + (Math.random() - 0.5) * 0.004);
    this.price = this.open;
    this.base = base; this.drift = drift;
    this.high = this.open; this.low = this.open;
    this.prevClose = null;
    this.avgPrice = null;
    this._hist = Array.from({ length: 30 }, (_, i) => base * (1 + Math.sin(i / 5) * 0.01 + (Math.random() - 0.5) * 0.005));
  }
  tick() {
    const shock = (Math.random() - 0.5) * this.base * 0.002 + this.drift * this.base;
    this.price = Math.max(this.base * 0.5, this.price + shock);
    this.high = Math.max(this.high, this.price);
    this.low  = Math.min(this.low,  this.price);
    this._hist.push(this.price); if (this._hist.length > 60) this._hist.shift();
  }
  applyReal(price, open, high, low, prevClose, avgPrice) {
    if (open  != null) this.open = open;
    if (high   != null) this.high = high;
    if (low    != null) this.low  = low;
    if (prevClose != null) this.prevClose = prevClose;
    if (avgPrice  != null) this.avgPrice = avgPrice;
    this.price = price;
    this._hist.push(price); if (this._hist.length > 60) this._hist.shift();
  }
  get pctChg() {
    if (this.prevClose != null && this.prevClose > 0) {
      return (this.price - this.prevClose) / this.prevClose;
    }
    return this.open > 0 ? (this.price - this.open) / this.open : 0;
  }
}

const quotes   = SEED_QUOTES.map(q => new Quote(q));
const quoteMap = Object.fromEntries(quotes.map(q => [q.code, q]));
const quoteByFugleSymbol = Object.fromEntries(quotes.map(q => [q.fugleSymbol, q]));
const quoteByYahooSymbol = Object.fromEntries(quotes.map(q => [q.yahooSymbol, q]));

function fmt(n, digits = 2) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function pctFmt(p) { return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'; }
function cls(p) { return p > 0.0005 ? 'up' : p < -0.0005 ? 'down' : 'flat'; }

// ============================================================
// MarketData service — 富果API（REST 主 / WebSocket 即時）/ Yahoo 備 / 離線模擬兜底
// ============================================================
const SOURCE_LABELS = {
  fugle_ws:   '來源：富果 API（WebSocket）',
  fugle_rest: '來源：富果 API（REST）',
  yahoo:      '來源：Yahoo Finance',
  mock:       '模擬數據（離線）',
};

// 依代號找對應的富果 symbol（指數走 indices 頻道）
function fugleTarget(q) {
  const s = q.fugleSymbol;
  return q.type === 'index'
    ? { channel: 'indices', symbol: s }
    : { channel: 'aggregates', symbol: s };
}

const MarketData = {
  source: 'mock',
  lastUpdated: 0,
  _ws: null,
  _wsAuthenticated: false,
  _wsSubscribed: false,
  _wsRetryUntil: 0,
  _restTimer: null,
  _wsState: 'idle',

  setSource(name) {
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

  // ---------- 富果 REST：intraday/quote ----------
  async fetchFuguoRest() {
    const f = apiCfg.fugle;
    if (!f.enabled || !f.apiKey) return 0;
    const restUrl = f.restUrl || FUGLE_REST_DEFAULT;
    const base = restUrl.replace(/\/$/, '');
    let ok = 0;

    for (const q of quotes) {
      const target = fugleTarget(q);
      const url = base + '/stock/intraday/quote/' + encodeURIComponent(target.symbol);
      try {
        const r = await fetch(url, { headers: { 'X-API-KEY': f.apiKey } });
        if (!r.ok) {
          if (r.status === 404 || r.status === 400) continue;
          throw new Error('HTTP ' + r.status);
        }
        const data = await r.json();
        // 富果 quote 回傳扁平結構：symbol, openPrice, lastPrice, highPrice, lowPrice, previousClose, avgPrice...
        const price = data.lastPrice ?? data.closePrice ?? data.price;
        if (price == null) continue;
        q.applyReal(
          price,
          data.openPrice,
          data.highPrice,
          data.lowPrice,
          data.previousClose,
          data.avgPrice
        );
        if (data.name) q.name = data.name;
        ok++;
      } catch (e) {
        console.warn('[SuperETF] 富果 REST 拉取 ' + target.symbol + ' 失敗：', e.message);
      }
    }

    if (ok > 0) {
      this.lastUpdated = Date.now();
      this.setSource('fugle_rest');
    }
    return ok;
  },

  // ---------- 富果 WebSocket：aggregates + indices 即時 ----------
  connectFuguoWs() {
    const f = apiCfg.fugle;
    if (!f.enabled || !f.apiKey) return;
    // 重連節流：斷線後 30 秒內不再嘗試
    if (Date.now() < this._wsRetryUntil) return;

    const wsUrl = f.wsUrl || FUGLE_WS_DEFAULT;
    let ws;
    try { ws = new WebSocket(wsUrl); }
    catch (e) {
      console.warn('[SuperETF] WebSocket 初始化失敗：', e.message);
      this._wsState = 'idle';
      this._wsRetryUntil = Date.now() + 30000;
      return;
    }
    this._ws = ws;
    this._wsAuthenticated = false;
    this._wsSubscribed = false;
    this._wsState = 'connecting';

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: 'auth', data: { apikey: f.apiKey } }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.event) {
        case 'authenticated':
          this._wsAuthenticated = true;
          this._wsState = 'authed';
          this._subscribeAll(ws);
          break;
        case 'error':
          console.warn('[SuperETF] 富果 WS error：', msg.data?.message || msg.data);
          break;
        case 'heartbeat':
        case 'pong':
          break;
        case 'data':
          this._onWsData(msg);
          break;
      }
    };

    ws.onclose = () => {
      this._wsState = 'closed';
      console.warn('[SuperETF] 富果 WebSocket 關閉，30 秒後重連');
      this._wsRetryUntil = Date.now() + 30000;
      if (this._restTimer) clearInterval(this._restTimer);
      this._startRestFallback();
    };

    ws.onerror = () => { /* onclose 會觸發 */ };

    // 30 秒 heartbeat ping
    this._wsPingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && this._wsAuthenticated) {
        ws.send(JSON.stringify({ event: 'ping' }));
      }
    }, 30000);
  },

  _subscribeAll(ws) {
    for (const q of quotes) {
      const t = fugleTarget(q);
      ws.send(JSON.stringify({
        event: 'subscribe',
        data: { channel: t.channel, symbol: t.symbol },
      }));
    }
    this._wsSubscribed = true;
    this.setSource('fugle_ws');
  },

  _onWsData(msg) {
    const d = msg.data;
    if (!d || !d.symbol) return;
    const q = quoteByFugleSymbol[d.symbol];
    if (!q) return;

    if (msg.channel === 'indices') {
      // indices 頻道：d.index = 現價；d.previousClose = 前收
      q.applyReal(d.index, d.openPrice, d.highPrice, d.lowPrice, d.previousClose, null);
    } else if (msg.channel === 'aggregates') {
      // aggregates 頻道：完整 OHLC + 五檔
      q.applyReal(
        d.lastPrice ?? d.closePrice,
        d.openPrice,
        d.highPrice,
        d.lowPrice,
        d.previousClose,
        d.avgPrice
      );
    }
    this.lastUpdated = Date.now();
    this.setSource('fugle_ws');
  },

  disconnectFuguoWs() {
    if (this._ws) { try { this._ws.close(); } catch {} }
    if (this._wsPingTimer) clearInterval(this._wsPingTimer);
    this._ws = null;
    this._wsAuthenticated = false;
    this._wsSubscribed = false;
    this._wsState = 'idle';
  },

  // REST 降級模式：WS 斷線時每 10 秒拉一次 quote
  _startRestFallback() {
    if (this._restTimer) clearInterval(this._restTimer);
    const f = apiCfg.fugle;
    if (!f.enabled || !f.apiKey || !f.wsAutoFallback) return;
    this._restTimer = setInterval(async () => {
      const n = await this.fetchFuguoRest();
      if (n === 0) {
        // 富果 REST 也失敗 → 降到 Yahoo
        await this.fetchYahoo();
      }
    }, 10000);
    this.setSource('fugle_rest');
  },

  // ---------- Yahoo Finance 備用 ----------
  async fetchYahoo() {
    const f = apiCfg.fugle;
    if (f.enabled && f.apiKey) return 0; // 富果啟用時，Yahoo 不主動搶
    let ok = 0;
    for (const q of quotes) {
      const sym = q.yahooSymbol;
      try {
        const r = await fetch(
          'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(sym) +
          '?interval=1d&range=1d'
        );
        if (!r.ok) continue;
        const data = await r.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) continue;
        const price = meta.regularMarketPrice ?? meta.chartPreviousClose;
        if (price == null) continue;
        q.applyReal(
          price,
          meta.regularMarketOpen ?? meta.chartPreviousClose,
          meta.regularMarketDayHigh,
          meta.regularMarketDayLow,
          meta.chartPreviousClose,
          meta.regularMarketDayHigh ?? null
        );
        ok++;
      } catch (e) {
        console.warn('[SuperETF] Yahoo 拉取 ' + sym + ' 失敗：', e.message);
      }
    }
    if (ok > 0) {
      this.lastUpdated = Date.now();
      this.setSource('yahoo');
    }
    return ok;
  },

  // ---------- 同步入口 ----------
  async sync() {
    const f = apiCfg.fugle;
    if (f.enabled && f.apiKey) {
      // 嘗試 WebSocket 即時
      this.connectFuguoWs();
      // 同時先做一次 REST 補上初始開盤價
      const n = await this.fetchFuguoRest();
      if (n > 0) return 'fugle_rest';
      return 'fugle_ws';
    }
    // 未啟用富果 → Yahoo 備用
    const y = await this.fetchYahoo();
    if (y > 0) return 'yahoo';
    return 'mock';
  },

  // 重新整理（設定变更后呼叫）
  reset() {
    this.disconnectFuguoWs();
    if (this._restTimer) clearInterval(this._restTimer);
    this._restTimer = null;
    this._wsRetryUntil = 0;
  },
};

// 離線兜底：模擬數據
function mockTickAll() {
  quotes.forEach(q => q.tick());
  MarketData.setSource('mock');
}

// ============================================================
// Live tab render
// ============================================================
function renderLive() {
  const grid = document.getElementById('live-grid');
  if (!grid) return;
  const activeType = document.querySelector('.chip.active')?.dataset.type || 'all';
  grid.innerHTML = quotes
    .filter(q => activeType === 'all' || q.type === activeType)
    .map(q => {
      const p = q.pctChg;
      return `
        <div class="live-card">
          <div class="code"><span>${q.code}</span><span class="type-tag">${q.type}</span></div>
          <div class="name">${q.name}</div>
          <div class="price ${cls(p)}">${fmt(q.price)}</div>
          <div class="chg ${cls(p)}">${pctFmt(p)}</div>
          ${q.avgPrice != null ? `<div class="vwap-tag">均價 ${fmt(q.avgPrice)}</div>` : ''}
        </div>`;
    }).join('');
}

// ============================================================
// PnL tab
// ============================================================
function renderPnl() {
  const summary = document.getElementById('pnl-summary');
  const wall = document.getElementById('pnl-wall');
  if (!summary || !wall) return;

  let totalCost = 0, totalMkt = 0;
  const tiles = holdings.map(h => {
    const q = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const cost  = h.qty * h.cost;
    const mkt   = h.qty * price;
    const pnl   = mkt - cost;
    totalCost += cost; totalMkt += mkt;
    const spark = q ? q._hist.slice(-20) : [];
    const sparkCanvas = q ? `<canvas class="spark" width="120" height="34" data-symbol="${h.code}"></canvas>` : '';
    return { h, price, pnl, spark, cost, mkt };
  });

  const totalPnl = totalMkt - totalCost;
  summary.innerHTML = `
    <div class="pnl-box"><div class="label">總成本</div><div class="value">${fmt(totalCost, 0)}</div></div>
    <div class="pnl-box"><div class="label">總市價</div><div class="value">${fmt(totalMkt, 0)}</div></div>
    <div class="pnl-box"><div class="label">總損益</div><div class="value ${cls(totalPnl / totalCost)}">${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl, 0)}</div></div>
    <div class="pnl-box"><div class="label">報酬率</div><div class="value ${cls(totalPnl / totalCost)}">${pctFmt(totalPnl / totalCost)}</div></div>`;

  wall.innerHTML = tiles.map(({ h, price, pnl, spark }) => `
    <div class="pnl-tile">
      <div class="head"><span>${h.code} ${h.name}</span><span class="${cls(pnl)}">${pnl >= 0 ? '+' : ''}${fmt(pnl, 0)}</span></div>
      <div class="pnl ${cls(pnl)}">${fmt(price)} · ${fmt(h.qty)}股</div>
      ${spark.length > 2 ? `<canvas class="spark" width="120" height="34" data-symbol="${h.code}"></canvas>` : ''}
    </div>`).join('');

  // 畫 sparklines
  document.querySelectorAll('canvas.spark[data-symbol]').forEach(cv => {
    const q = quoteMap[cv.dataset.symbol];
    if (!q) return;
    drawSpark(cv, q._hist.slice(-20), q.pctChg);
  });
}

function drawSpark(canvas, data, chg) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  ctx.beginPath();
  ctx.strokeStyle = chg >= 0 ? 'var(--green)' : 'var(--red)';
  ctx.lineWidth = 1.5;
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ============================================================
// Portfolio tab
// ============================================================
function renderPortfolio() {
  const body = document.getElementById('portfolio-body');
  const txnsEl = document.getElementById('transactions');
  if (!body) return;
  const totalMkt = holdings.reduce((s, h) => s + h.qty * (quoteMap[h.code]?.price ?? h.cost), 0);
  body.innerHTML = holdings.map(h => {
    const q = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const mkt = h.qty * price;
    const cost = h.qty * h.cost;
    const pnl = mkt - cost;
    const ratio = totalMkt > 0 ? (mkt / totalMkt) * 100 : 0;
    const idx = holdings.indexOf(h);
    return `<tr>
      <td>${h.code}</td><td>${h.name}</td>
      <td>${h.qty.toLocaleString()}</td>
      <td>${fmt(h.cost)}</td>
      <td class="${cls((price - h.cost) / h.cost)}">${fmt(price)}</td>
      <td class="${cls(pnl / cost)}">${pnl >= 0 ? '+' : ''}${fmt(pnl, 0)}（${pctFmt(pnl / cost)}）</td>
      <td>${ratio.toFixed(1)}%</td>
      <td><button class="del-btn" data-idx="${idx}" title="移除持倉">×</button></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      holdings.splice(idx, 1);
      save(LS.holdings, holdings);
      renderPortfolio();
    });
  });

  if (txnsEl) {
    txnsEl.innerHTML = txns.length
      ? `<h3>交易記錄</h3><div class="txn-list">${txns.map((t, i) => `
        <div class="txn-item">
          <span>${t.side === 'buy' ? '🟢 買' : '🔴 賣'} ${t.code} ${t.name} × ${Math.abs(t.qty).toLocaleString()} @ ${fmt(t.price)}</span>
          <span class="date">${t.date}</span>
        </div>`).join('')}</div>`
      : '';
  }
}

// ============================================================
// Dividends tab
// ============================================================
function renderDividends() {
  const list = document.getElementById('dividend-list');
  const sumEl = document.getElementById('dividend-summary');
  if (!list) return;
  const total = dividends.reduce((s, d) => s + d.qty * d.amount, 0);
  if (sumEl) {
    sumEl.innerHTML = `
      <div class="pnl-box"><div class="label">本年度預估總股息</div><div class="value">${fmt(total, 0)}</div></div>
      <div class="pnl-box"><div class="label">筆數</div><div class="value">${dividends.length}</div></div>`;
  }
  list.innerHTML = dividends.map((d, i) => `
    <div class="div-item">
      <span>${d.code} ${d.name} · ${d.qty.toLocaleString()}股 × ${fmt(d.amount)} = <b>${fmt(d.qty * d.amount, 0)}</b></span>
      <span style="color:var(--muted);font-size:12px">${d.date}</span>
      <button class="del-btn" data-idx="${i}" title="移除">×</button>
    </div>`).join('');
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dividends.splice(Number(btn.dataset.idx), 1);
      save(LS.dividends, dividends);
      renderDividends();
    });
  });
}

// ============================================================
// Analysis tab
// ============================================================
function drawAnalysis() {
  const canvas = document.getElementById('analysis-canvas');
  const t = quoteMap['^TSE'];
  if (!canvas || !t) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const data = t._hist.slice(-40);
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;

  ctx.beginPath();
  ctx.strokeStyle = t.pctChg >= 0 ? 'var(--green)' : 'var(--red)';
  ctx.lineWidth = 2;
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 20 - ((v - min) / range) * (h - 40);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  const vwap   = data.reduce((s, v) => s + v, 0) / data.length;
  const dayRng = t.open > 0 ? (t.high - t.low) / t.open : 0;
  document.getElementById('analysis-metrics').innerHTML = `
    <div class="metric"><div class="label">加權開盤</div><div class="value">${fmt(t.open)}</div></div>
    <div class="metric"><div class="label">現價</div><div class="value ${cls(t.pctChg)}">${fmt(t.price)}</div></div>
    <div class="metric"><div class="label">日區間</div><div class="value">${fmt(t.low)} – ${fmt(t.high)}</div></div>
    <div class="metric"><div class="label">VWAP</div><div class="value">${fmt(vwap)}</div></div>
    <div class="metric"><div class="label">日波動度</div><div class="value">${(dayRng * 100).toFixed(2)}%</div></div>`;

  const srcLabel = SOURCE_LABELS[MarketData.source] || '模擬數據';
  const h0050    = holdings.find(h => h.code === '0050');
  document.getElementById('analysis-notes').innerHTML =
    `<strong style="color:var(--text)">市場解讀</strong>（${srcLabel}）<br>` +
    `• 加權指數開盤 <b>${fmt(t.open)}</b>，現價 <b class="${cls(t.pctChg)}">${fmt(t.price)}</b>（${pctFmt(t.pctChg)}）。<br>` +
    `• 日內波動區間 ${fmt(t.low)}–${fmt(t.high)}，區間幅度 ${(dayRng * 100).toFixed(2)}%。<br>` +
    (h0050 ? `• 0050 持倉 ${h0050.qty.toLocaleString()} 股，成本 ${fmt(h0050.cost)}。` : '');
}

// ============================================================
// Settings tab — 富果 API 設定存取（v2 架構）
// ============================================================
function loadSettingsForm() {
  const f = apiCfg.fugle;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  setVal('cfg-fugle-enabled',        null); // 依 checkbox
  const enabledEl = document.getElementById('cfg-fugle-enabled');
  if (enabledEl) enabledEl.checked = f.enabled;
  setVal('cfg-fugle-resturl', f.restUrl || FUGLE_REST_DEFAULT);
  setVal('cfg-fugle-wsurl',   f.wsUrl   || FUGLE_WS_DEFAULT);
  setVal('cfg-fugle-key',     f.apiKey);
  const autoEl = document.getElementById('cfg-fugle-ws-autofallback');
  if (autoEl) autoEl.checked = f.wsAutoFallback;
  updateSourcePriorityBadges();
}

function updateSourcePriorityBadges() {
  const fuBadge = document.getElementById('src-prio-fuguo');
  if (fuBadge) {
    if (apiCfg.fugle.enabled && apiCfg.fugle.apiKey) {
      fuBadge.textContent = apiCfg.fugle.wsAutoFallback ? '已設定（WS + REST）' : '已設定（REST）';
      fuBadge.className   = 'source-badge fuguo';
    } else {
      fuBadge.textContent = '未設定';
      fuBadge.className   = 'source-badge mock';
    }
  }
}

function setFeedback(msg, ok) {
  const el = document.getElementById('cfg-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'settings-feedback ' + (ok ? 'ok' : 'err');
}

document.getElementById('cfg-save').addEventListener('click', () => {
  const enabled   = document.getElementById('cfg-fugle-enabled').checked;
  const restUrl   = document.getElementById('cfg-fugle-resturl').value.trim() || FUGLE_REST_DEFAULT;
  const wsUrl     = document.getElementById('cfg-fugle-wsurl').value.trim()   || FUGLE_WS_DEFAULT;
  const apiKey    = document.getElementById('cfg-fugle-key').value.trim();
  const wsAutoFallback = document.getElementById('cfg-fugle-ws-autofallback')?.checked ?? true;

  apiCfg = { fugle: { enabled, restUrl, wsUrl, apiKey, wsAutoFallback } };
  saveApiConfig(apiCfg);

  MarketData.reset();
  const summary = enabled && apiKey
    ? '已保存：富果 API 已啟用' + (wsAutoFallback ? '（WebSocket 即時 + REST 降級）' : '（REST 模式）')
    : '已保存：富果 API 未啟用，將使用 Yahoo Finance 備用';
  setFeedback(summary, true);
  updateSourcePriorityBadges();
  MarketData.sync().then(src => {
    setFeedback(summary + '（目前來源：' + (SOURCE_LABELS[src] || src) + '）', true);
  });
});

document.getElementById('cfg-test').addEventListener('click', async () => {
  const f = apiCfg.fugle;
  const restUrl = document.getElementById('cfg-fugle-resturl').value.trim() || FUGLE_REST_DEFAULT;
  const apiKey  = document.getElementById('cfg-fugle-key').value.trim();
  if (!apiKey) { setFeedback('請先填入 API Key', false); return; }
  setFeedback('測試中…', true);
  try {
    const testSymbol = '0050';
    const url = restUrl.replace(/\/$/, '') + '/stock/intraday/quote/' + testSymbol;
    const r = await fetch(url, { headers: { 'X-API-KEY': apiKey } });
    if (r.ok) {
      const data = await r.json();
      const p = data.lastPrice ?? data.closePrice ?? data.price ?? '（200 OK）';
      setFeedback('✅ 富果 API 連線成功：0050 最新價 ' + p, true);
    } else {
      setFeedback('❌ 連線失敗：HTTP ' + r.status + '（請檢查 API Key 是否有效）', false);
    }
  } catch (e) {
    setFeedback('❌ 連線失敗：' + e.message + '（可能是 CORS 或網路問題）', false);
  }
});

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('tab-' + tab.dataset.tab);
    if (panel) panel.classList.add('active');
    if (tab.dataset.tab === 'settings') loadSettingsForm();
  });
});

// filter chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderLive();
  });
});

// 新增持倉
document.getElementById('btn-add-holding').addEventListener('click', () => {
  document.getElementById('add-holding-form').classList.toggle('hidden');
});
document.getElementById('fh-cancel').addEventListener('click', () => {
  document.getElementById('add-holding-form').classList.add('hidden');
});
document.getElementById('fh-save').addEventListener('click', () => {
  const code = document.getElementById('fh-code').value.trim();
  const name = document.getElementById('fh-name').value.trim();
  const qty  = Number(document.getElementById('fh-qty').value) || 0;
  const cost = Number(document.getElementById('fh-cost').value) || 0;
  if (!code || qty <= 0) return;
  const existing = holdings.find(h => h.code === code);
  if (existing) {
    existing.qty += qty;
    existing.cost = (existing.cost * existing.qty + cost * qty) / existing.qty;
  } else {
    holdings.push({ code, name: name || code, qty, cost });
  }
  save(LS.holdings, holdings);
  document.getElementById('add-holding-form').classList.add('hidden');
  document.getElementById('fh-code').value = '';
  document.getElementById('fh-name').value = '';
  document.getElementById('fh-qty').value  = '';
  document.getElementById('fh-cost').value  = '';
  renderPortfolio();
});

// 新增股息
document.getElementById('btn-add-dividend').addEventListener('click', () => {
  document.getElementById('add-dividend-form').classList.toggle('hidden');
});
document.getElementById('fd-cancel').addEventListener('click', () => {
  document.getElementById('add-dividend-form').classList.add('hidden');
});
document.getElementById('fd-save').addEventListener('click', () => {
  const code   = document.getElementById('fd-code').value.trim();
  const name   = document.getElementById('fd-name').value.trim();
  const qty    = Number(document.getElementById('fd-qty').value) || 0;
  const amount = Number(document.getElementById('fd-amount').value) || 0;
  const date   = document.getElementById('fd-date').value || new Date().toISOString().slice(0, 10);
  if (!code || qty <= 0) return;
  dividends.push({ code, name: name || code, qty, amount, date });
  save(LS.dividends, dividends);
  document.getElementById('add-dividend-form').classList.add('hidden');
  ['fd-code','fd-name','fd-qty','fd-amount','fd-date'].forEach(id => document.getElementById(id).value = '');
  renderDividends();
});

// ---------- Tick loop（離線模擬時啟用；有真實資料時跳過 random-walk）----------
setInterval(() => {
  if (MarketData.source === 'mock') {
    mockTickAll();
  }
  if (document.getElementById('tab-live')?.classList.contains('active'))     renderLive();
  if (document.getElementById('tab-pnl')?.classList.contains('active'))    renderPnl();
  if (document.getElementById('tab-portfolio')?.classList.contains('active')) renderPortfolio();
  if (document.getElementById('tab-analysis')?.classList.contains('active'))  drawAnalysis();
}, 2000);

// ---------- Init ----------
renderLive(); renderPnl(); renderPortfolio(); renderDividends(); drawAnalysis();
loadSettingsForm();
MarketData.sync();
console.log('SuperETF v' + VERSION);

})();
