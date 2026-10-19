(() => {
'use strict';

const VERSION = '1.1.0';

// ---------- API 設定（存於 localStorage，由「設置」tab 管理）----------
const LS_API  = 'setf_api_config';
const API_DEFAULTS = {
  fuguo: {
    enabled:  false,
    baseUrl:  '',
    apiKey:   '',
    symbols:  {},   // 例：{ '0050': 'TWSE:0050', '^TWSE': 'TWSE' }
  },
};
function loadApiConfig() {
  try {
    const raw = localStorage.getItem(LS_API);
    if (!raw) return structuredClone(API_DEFAULTS);
    const saved = JSON.parse(raw);
    return {
      fuguo: {
        enabled:  !!saved?.fuguo?.enabled,
        baseUrl:  saved?.fuguo?.baseUrl  || '',
        apiKey:   saved?.fuguo?.apiKey   || '',
        symbols:  saved?.fuguo?.symbols  || {},
      },
    };
  } catch { return structuredClone(API_DEFAULTS); }
}
function saveApiConfig(cfg) {
  try { localStorage.setItem(LS_API, JSON.stringify(cfg)); } catch {}
}
let apiCfg = loadApiConfig();

// ---------- Seed data ----------
const SEED_QUOTES = [
  { code: '^TWSE',  name: '加權指數',     type: 'index', base: 23500, drift: 0.001,  yahoo: '^TWSE'   },
  { code: '0050',   name: '元大50',       type: 'etf',   base: 18.35, drift: 0.0005, yahoo: '0050.TW'  },
  { code: '0056',   name: '國泰AP',       type: 'etf',   base: 31.50, drift: 0.0004, yahoo: '0056.TW'  },
  { code: '00859',  name: '元大S&P500',   type: 'etf',   base: 15.80, drift: 0.0006, yahoo: '00859.TW' },
  { code: '2884',   name: '聯電',         type: 'stock', base: 42.50, drift: 0.0008, yahoo: '2884.TW'  },
  { code: '2330',   name: '台積電',       type: 'stock', base: 1010,  drift: 0.0004, yahoo: '2330.TW'  },
  { code: '6605',   name: '台達電',       type: 'stock', base: 485,   drift: 0.0009, yahoo: '6605.TW'  },
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
  constructor({ code, name, type, base, drift, yahoo }) {
    this.code = code; this.name = name; this.type = type;
    this.yahooSymbol = yahoo || (code.endsWith('.TW') ? code : code + '.TW');
    this.open = base * (1 + (Math.random() - 0.5) * 0.004);
    this.price = this.open;
    this.base = base; this.drift = drift;
    this.high = this.open; this.low = this.open;
    this._hist = Array.from({ length: 30 }, (_, i) => base * (1 + Math.sin(i / 5) * 0.01 + (Math.random() - 0.5) * 0.005));
  }
  tick() {
    const shock = (Math.random() - 0.5) * this.base * 0.002 + this.drift * this.base;
    this.price = Math.max(this.base * 0.5, this.price + shock);
    this.high = Math.max(this.high, this.price);
    this.low  = Math.min(this.low,  this.price);
    this._hist.push(this.price); if (this._hist.length > 60) this._hist.shift();
  }
  applyReal(price, open) {
    if (open) this.open = open;
    this.price = price;
    this.high = Math.max(this.high, price);
    this.low  = Math.min(this.low,  price);
    this._hist.push(price); if (this._hist.length > 60) this._hist.shift();
  }
  get pctChg() { return (this.price - this.open) / this.open; }
}

const quotes   = SEED_QUOTES.map(q => new Quote(q));
const quoteMap = Object.fromEntries(quotes.map(q => [q.code, q]));

function fmt(n, digits = 2) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function pctFmt(p) { return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'; }
function cls(p) { return p > 0.0005 ? 'up' : p < -0.0005 ? 'down' : 'flat'; }

// ============================================================
// MarketData service — 富果API 主 / Yahoo 備 / 離線模擬兜底
// ============================================================
const SOURCE_LABELS = {
  fuguo: '來源：富果API',
  yahoo: '來源：Yahoo Finance',
  mock:  '模擬數據（離線）',
};

const MarketData = {
  source: 'mock',
  lastUpdated: 0,

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

  // 主：富果API（依 apiCfg.fuguo 動態判斷）
  async fetchFuguo() {
    const f = apiCfg.fuguo;
    if (!f.enabled || !f.baseUrl) return 0;
    try {
      const targets = quotes.filter(q => f.symbols[q.code]);
      if (!targets.length) return 0;
      const batch = await Promise.all(targets.map(async q => {
        const sym = f.symbols[q.code];
        const sep = f.baseUrl.includes('?') ? '&' : '?';
        const url = f.baseUrl + encodeURIComponent(sym)
          + (f.apiKey ? (sep + 'key=' + encodeURIComponent(f.apiKey)) : '');
        const headers = f.apiKey ? { 'X-Api-Key': f.apiKey } : {};
        const r = await fetch(url, { headers });
        if (!r.ok) throw new Error('fuguo ' + r.status);
        const data = await r.json();
        const p = data.price ?? data.quote?.price ?? data.last ?? null;
        const o = data.open  ?? data.quote?.open  ?? data.open ?? p;
        return p ? { code: q.code, price: p, open: o } : null;
      }));
      const valid = batch.filter(Boolean);
      valid.forEach(v => { const q = quoteMap[v.code]; if (q) q.applyReal(v.price, v.open); });
      return valid.length;
    } catch (e) { console.warn('[fuguo]', e); return 0; }
  },

  // 備：Yahoo Finance
  async fetchYahoo() {
    try {
      const symbols = quotes.map(q => q.yahooSymbol);
      const url = 'https://query1.finance.yahoo.com/v8/finance/spark?symbols=' + symbols.join(',')
        + '&range=1d&interval=1m';
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('yahoo ' + r.status);
      const data = await r.json();
      const result = data.result || [];
      let count = 0;
      for (const item of result) {
        const q = quotes.find(x => x.yahooSymbol === item.symbol);
        if (!q || !item.price || !Array.isArray(item.price.items)) continue;
        const last = item.price.items[item.price.items.length - 1];
        if (last == null) continue;
        q.applyReal(last, item.open);
        count++;
      }
      if (count) this.lastUpdated = Date.now();
      return count;
    } catch (e) { console.warn('[yahoo]', e); return 0; }
  },

  async sync() {
    const fu = await this.fetchFuguo();
    if (fu > 0) { this.setSource('fuguo'); this.lastUpdated = Date.now(); return 'fuguo'; }
    const yh = await this.fetchYahoo();
    if (yh > 0)  { this.setSource('yahoo'); this.lastUpdated = Date.now(); return 'yahoo'; }
    this.setSource('mock');
    return 'mock';
  },
};

async function marketLoop() {
  await MarketData.sync();
  renderLive();
}
marketLoop();
setInterval(marketLoop, 30000);

// ---------- Session badge ----------
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= 570 && t < 840; // 09:30–14:00 台北
}
function updateBadge() {
  const el = document.getElementById('session-badge');
  if (isMarketOpen()) { el.textContent = '開盤中'; el.className = 'session-badge open'; }
  else { el.textContent = '盤前 / 盤後'; el.className = 'session-badge closed'; }
}
setInterval(updateBadge, 30000); updateBadge();

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'analysis') drawAnalysis();
    if (btn.dataset.tab === 'settings') loadSettingsForm();
  });
});

// ---------- Live grid ----------
let liveFilter = 'all';
document.querySelectorAll('.chip').forEach(c => {
  c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    liveFilter = c.dataset.type;
    renderLive();
  });
});

function renderLive() {
  const grid = document.getElementById('live-grid');
  if (!grid) return;
  const list = quotes.filter(q => liveFilter === 'all' || q.type === liveFilter);
  grid.innerHTML = list.map(q => {
    const p = q.pctChg;
    const typeLabel = q.type === 'index' ? '指數' : q.type === 'etf' ? 'ETF' : '個股';
    return `<div class="live-card">
      <div class="code"><span>${q.code.replace('^','')}</span><span>${typeLabel}</span></div>
      <div class="name">${q.name}</div>
      <div class="price ${cls(p)}">${fmt(q.price)}</div>
      <div class="chg ${cls(p)}">${pctFmt(p)} <span style="color:var(--muted);font-size:11px">開 ${fmt(q.open)}</span></div>
    </div>`;
  }).join('');
}

// ---------- PnL wall ----------
function renderPnl() {
  const summary = document.getElementById('pnl-summary');
  const wall    = document.getElementById('pnl-wall');
  let totalCost = 0, totalValue = 0;
  const tiles = holdings.map(h => {
    const q      = quoteMap[h.code];
    const price  = q ? q.price : h.cost;
    const pnl    = (price - h.cost) * h.qty;
    const pnlPct = h.cost ? (price - h.cost) / h.cost : 0;
    const cost   = h.cost * h.qty;
    const value  = price * h.qty;
    totalCost  += cost;
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
    const q = quoteMap[h.code];
    const sparkCanvas = `<canvas class="spark" data-code="${h.code}" width="200" height="34"></canvas>`;
    return `<div class="pnl-tile">
      <div class="head"><span>${h.code} ${h.name}</span><span>${h.qty} 股</span></div>
      <div class="pnl ${cls(pnlPct)}">${pnl >= 0 ? '+' : ''}${fmt(pnl)}（${pctFmt(pnlPct)}）</div>
      ${sparkCanvas}
      <div style="font-size:11px;color:var(--muted)">現價 ${fmt(price)} · 成本 ${fmt(h.cost)}</div>
    </div>`;
  }).join('');

  wall.querySelectorAll('.spark').forEach(cv => {
    const q = quoteMap[cv.dataset.code];
    if (!q) return;
    const ctx = cv.getContext('2d');
    const data = q._hist.slice(-30);
    if (!data.length) return;
    const w = cv.width, h2 = cv.height;
    ctx.clearRect(0, 0, w, h2);
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    ctx.strokeStyle = q.pctChg >= 0 ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h2 - 2 - ((v - min) / range) * (h2 - 4);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

// ---------- Portfolio ----------
document.getElementById('btn-add-holding').addEventListener('click', () => {
  document.getElementById('add-holding-form').classList.toggle('hidden');
});
document.getElementById('fh-cancel').addEventListener('click', () => {
  document.getElementById('add-holding-form').classList.add('hidden');
});
document.getElementById('fh-save').addEventListener('click', () => {
  const code = document.getElementById('fh-code').value.trim();
  const name = document.getElementById('fh-name').value.trim();
  const qty  = parseInt(document.getElementById('fh-qty').value)   || 0;
  const cost = parseFloat(document.getElementById('fh-cost').value) || 0;
  if (!code || !qty) return alert('請填入代號與股數');
  holdings.push({ code, name: name || code, qty, cost });
  save(LS.holdings, holdings);
  document.getElementById('add-holding-form').classList.add('hidden');
  ['fh-code','fh-name','fh-qty','fh-cost'].forEach(id => document.getElementById(id).value = '');
  renderPortfolio(); renderPnl();
});

function renderPortfolio() {
  const body = document.getElementById('portfolio-body');
  const totalValue = holdings.reduce((s, h) => s + (quoteMap[h.code] ? quoteMap[h.code].price : h.cost) * h.qty, 0);
  body.innerHTML = holdings.map((h, i) => {
    const q     = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const value = price * h.qty;
    const cost  = h.cost * h.qty;
    const pnl   = value - cost;
    const pct   = totalValue ? value / totalValue : 0;
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
      const i = parseInt(b.dataset.i);
      holdings.splice(i, 1);
      save(LS.holdings, holdings);
      renderPortfolio(); renderPnl();
    });
  });
  renderTransactions();
}

function renderTransactions() {
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
document.getElementById('btn-add-dividend').addEventListener('click', () => {
  document.getElementById('add-dividend-form').classList.toggle('hidden');
});
document.getElementById('fd-cancel').addEventListener('click', () => {
  document.getElementById('add-dividend-form').classList.add('hidden');
});
document.getElementById('fd-save').addEventListener('click', () => {
  const code   = document.getElementById('fd-code').value.trim();
  const name   = document.getElementById('fd-name').value.trim();
  const qty    = parseInt(document.getElementById('fd-qty').value)    || 0;
  const amount = parseFloat(document.getElementById('fd-amount').value) || 0;
  const date   = document.getElementById('fd-date').value || new Date().toISOString().slice(0, 10);
  if (!code || !qty) return alert('請填入代號與股數');
  dividends.push({ code, name: name || code, qty, amount, date });
  save(LS.dividends, dividends);
  document.getElementById('add-dividend-form').classList.add('hidden');
  ['fd-code','fd-name','fd-qty','fd-amount','fd-date'].forEach(id => document.getElementById(id).value = '');
  renderDividends(); renderPnl();
});

function renderDividends() {
  const year = new Date().getFullYear().toString();
  const list = dividends.filter(d => d.date.startsWith(year));
  const total = list.reduce((s, d) => s + d.qty * d.amount, 0);
  const yieldPct = holdings.length ? total / (holdings.reduce((s, h) => s + h.cost * h.qty, 0)) : 0;
  document.getElementById('dividend-summary').innerHTML = `
    <div class="pnl-box"><div class="label">本年度股息總額</div><div class="value up">NT$ ${fmt(total)}</div></div>
    <div class="pnl-box"><div class="label">股息率（對成本）</div><div class="value">${(yieldPct * 100).toFixed(2)}%</div></div>`;
  const el = document.getElementById('dividend-list');
  el.innerHTML = dividends.length
    ? dividends.slice().reverse().map(d => `
      <div class="div-item">
        <span><strong>${d.code}</strong> ${d.name} · ${d.qty} 股 × ${fmt(d.amount)} <span style="color:var(--muted);font-size:12px">${d.date}</span></span>
        <span class="total">+${fmt(d.qty * d.amount)}</span>
      </div>`).join('')
    : '<div style="color:var(--muted);padding:20px;text-align:center">尚無股息紀錄</div>';
}

// ---------- Analysis ----------
function drawAnalysis() {
  const canvas = document.getElementById('analysis-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const t    = quoteMap['^TWSE'];
  if (!t) return;
  const data = t._hist;
  if (!data.length) return;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const up = data[data.length - 1] >= data[0];

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
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  const vwap   = data.reduce((s, v) => s + v, 0) / data.length;
  const dayRng = (t.high - t.low) / t.open;
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
// Settings tab — API 設定存取
// ============================================================
function loadSettingsForm() {
  const f = apiCfg.fuguo;
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  setVal('cfg-fuguo-baseurl',    f.baseUrl);
  setVal('cfg-fuguo-key',        f.apiKey);
  setVal('cfg-fuguo-symbols',    Object.keys(f.symbols).length ? JSON.stringify(f.symbols, null, 2) : '');
  const chk = document.getElementById('cfg-fuguo-enabled');
  if (chk) chk.checked = f.enabled;
  updateSourcePriorityBadges();
}

function updateSourcePriorityBadges() {
  const fuBadge = document.getElementById('src-prio-fuguo');
  if (fuBadge) {
    if (apiCfg.fuguo.enabled && apiCfg.fuguo.baseUrl) {
      fuBadge.textContent = '已設定';
      fuBadge.className   = 'source-badge fuguo';
    } else {
      fuBadge.textContent = '未設定';
      fuBadge.className   = 'source-badge mock';
    }
  }
}

function parseSymbolsJson(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error();
    return obj;
  } catch {
    throw new Error('代號對應格式錯誤，請使用 JSON 物件，例如 {"0050":"TWSE:0050"}');
  }
}

function setFeedback(msg, ok) {
  const el = document.getElementById('cfg-feedback');
  el.textContent = msg;
  el.className = 'settings-feedback ' + (ok ? 'ok' : 'err');
}

document.getElementById('cfg-save').addEventListener('click', () => {
  const f = apiCfg.fuguo;
  const enabled = document.getElementById('cfg-fuguo-enabled').checked;
  const baseUrl = document.getElementById('cfg-fuguo-baseurl').value.trim();
  const apiKey  = document.getElementById('cfg-fuguo-key').value.trim();
  let symbols = {};
  try {
    symbols = parseSymbolsJson(document.getElementById('cfg-fuguo-symbols').value);
  } catch (e) {
    setFeedback(e.message, false);
    return;
  }

  apiCfg = { fuguo: { enabled, baseUrl, apiKey, symbols } };
  saveApiConfig(apiCfg);

  const summary = enabled && baseUrl
    ? '已保存：富果API 已啟用，即時行情將優先使用富果來源'
    : '已保存：富果API 未啟用，即時行情將使用 Yahoo Finance';
  setFeedback(summary, true);
  updateSourcePriorityBadges();
  // 立即重新同步一次
  MarketData.sync().then(src => {
    setFeedback(summary + '（目前來源：' + (SOURCE_LABELS[src] || src) + '）', true);
  });
});

document.getElementById('cfg-test').addEventListener('click', async () => {
  const f = apiCfg.fuguo;
  if (!f.baseUrl) { setFeedback('請先填入 API Endpoint', false); return; }
  setFeedback('測試中…', true);
  try {
    const testCode = Object.keys(f.symbols)[0] || '0050';
    const sym = f.symbols[testCode] || testCode;
    const sep = f.baseUrl.includes('?') ? '&' : '?';
    const url = f.baseUrl + encodeURIComponent(sym)
      + (f.apiKey ? (sep + 'key=' + encodeURIComponent(f.apiKey)) : '');
    const r = await fetch(url, { headers: f.apiKey ? { 'X-Api-Key': f.apiKey } : {} });
    if (r.ok) {
      const data = await r.json();
      const p = data.price ?? data.quote?.price ?? data.last ?? '（200 OK）';
      setFeedback('✅ 連線成功：' + testCode + ' 回應 ' + JSON.stringify(p), true);
    } else {
      setFeedback('❌ 連線失敗：HTTP ' + r.status, false);
    }
  } catch (e) {
    setFeedback('❌ 連線失敗：' + e.message, false);
  }
});

// ---------- Tick loop（離線模擬時啟用；有真實資料時跳過 random-walk） ----------
setInterval(() => {
  if (MarketData.source === 'mock') {
    quotes.forEach(q => q.tick());
  }
  if (document.getElementById('tab-live').classList.contains('active')) renderLive();
  if (document.getElementById('tab-pnl').classList.contains('active')) renderPnl();
  if (document.getElementById('tab-portfolio').classList.contains('active')) renderPortfolio();
  if (document.getElementById('tab-analysis').classList.contains('active')) drawAnalysis();
}, 2000);

// ---------- Init ----------
renderLive(); renderPnl(); renderPortfolio(); renderDividends();
console.log('SuperETF v' + VERSION);

})();
