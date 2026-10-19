(() => {
'use strict';

// ---------- Seed data ----------
const SEED_QUOTES = [
  { code: 'TAIEX', name: '加權指數', type: 'index', base: 23500, drift: 0.001 },
  { code: 'TAIEX-BIG', name: '加權（大）', type: 'index', base: 23480, drift: 0.001 },
  { code: '0050', name: '元大50', type: 'etf', base: 18.35, drift: 0.0005 },
  { code: '0056', name: '國泰AP', type: 'etf', base: 31.50, drift: 0.0004 },
  { code: '00859', name: '元大S&P500', type: 'etf', base: 15.80, drift: 0.0006 },
  { code: '2884', name: '聯電', type: 'stock', base: 42.50, drift: 0.0008 },
  { code: '2330', name: '台積電', type: 'stock', base: 1010, drift: 0.0004 },
  { code: '6605', name: '台達電', type: 'stock', base: 485, drift: 0.0009 },
];

const SEED_HOLDINGS = [
  { code: '0050', name: '元大50', qty: 5000, cost: 18.02 },
  { code: '2330', name: '台積電', qty: 50, cost: 985.00 },
  { code: '0056', name: '國泰AP', qty: 2000, cost: 30.80 },
];

const SEED_DIVIDENDS = [
  { code: '0050', name: '元大50', qty: 5000, amount: 0.22, date: '2026-03-15' },
  { code: '2330', name: '台積電', qty: 50, amount: 18.5, date: '2026-04-20' },
];

const SEED_TXNS = [
  { code: '0050', name: '元大50', qty: +5000, price: 18.02, date: '2026-01-10', side: 'buy' },
  { code: '2330', name: '台積電', qty: +50, price: 985.00, date: '2026-01-12', side: 'buy' },
  { code: '0056', name: '國泰AP', qty: +2000, price: 30.80, date: '2026-02-05', side: 'buy' },
];

// ---------- State (localStorage-backed) ----------
const LS = { holdings: 'setf_holdings', dividends: 'setf_dividends', txns: 'setf_txns' };
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

let holdings = load(LS.holdings, SEED_HOLDINGS);
let dividends = load(LS.dividends, SEED_DIVIDENDS);
let txns = load(LS.txns, SEED_TXNS);
save(LS.holdings, holdings); save(LS.dividends, dividends); save(LS.txns, txns);

// ---------- Market simulation ----------
class Quote {
  constructor({ code, name, type, base, drift }) {
    this.code = code; this.name = name; this.type = type;
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
    this.low = Math.min(this.low, this.price);
    this._hist.push(this.price); if (this._hist.length > 60) this._hist.shift();
  }
  get pctChg() { return (this.price - this.open) / this.open; }
}

const quotes = SEED_QUOTES.map(q => new Quote(q));
const quoteMap = Object.fromEntries(quotes.map(q => [q.code, q]));

function fmt(n, digits = 2) { return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function pctFmt(p) { return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'; }
function cls(p) { return p > 0.0005 ? 'up' : p < -0.0005 ? 'down' : 'flat'; }

// ---------- Session badge ----------
function isMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= 570 && t < 840; // 09:30–14:00
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
  const list = quotes.filter(q => liveFilter === 'all' || q.type === liveFilter);
  grid.innerHTML = list.map(q => {
    const p = q.pctChg;
    return `<div class="live-card">
      <div class="code"><span>${q.code}</span><span>${q.type === 'index' ? '指數' : q.type === 'etf' ? 'ETF' : '個股'}</span></div>
      <div class="name">${q.name}</div>
      <div class="price ${cls(p)}">${fmt(q.price)}</div>
      <div class="chg ${cls(p)}">${pctFmt(p)} <span style="color:var(--muted);font-size:11px">開 ${fmt(q.open)}</span></div>
    </div>`;
  }).join('');
}

// ---------- PnL wall ----------
function renderPnl() {
  const summary = document.getElementById('pnl-summary');
  const wall = document.getElementById('pnl-wall');
  let totalCost = 0, totalValue = 0;
  const tiles = holdings.map(h => {
    const q = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const pnl = (price - h.cost) * h.qty;
    const pnlPct = h.cost ? (price - h.cost) / h.cost : 0;
    totalCost += h.cost * h.qty; totalValue += price * h.qty;
    return { h, price, pnl, pnlPct, q };
  });
  const totalPnl = totalValue - totalCost;
  const totalPct = totalCost ? totalPnl / totalCost : 0;
  const divIncome = dividends.reduce((s, d) => s + d.qty * d.amount, 0);
  summary.innerHTML = `
    <div class="pnl-box"><div class="label">總市值</div><div class="value">NT$ ${fmt(totalValue)}</div></div>
    <div class="pnl-box"><div class="label">總成本</div><div class="value">NT$ ${fmt(totalCost)}</div></div>
    <div class="pnl-box"><div class="label">總損益</div><div class="value ${cls(totalPnl)}">${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)}</div></div>
    <div class="pnl-box"><div class="label">收益率</div><div class="value ${cls(totalPct)}">${pctFmt(totalPct)}</div></div>
    <div class="pnl-box"><div class="label">本年度股息</div><div class="value up">NT$ ${fmt(divIncome)}</div></div>`;
  wall.innerHTML = tiles.map(({ h, price, pnl, pnlPct, q }) => `
    <div class="pnl-tile">
      <div class="head"><strong>${h.code}</strong><span style="color:var(--muted)">${h.qty} 股</span></div>
      <div style="font-size:13px;color:var(--muted)">${h.name}</div>
      <div class="pnl ${cls(pnl)}">${pnl >= 0 ? '+' : ''}${fmt(pnl)} <span style="font-size:12px">(${pctFmt(pnlPct)})</span></div>
      <canvas class="spark" width="180" height="34"></canvas>
    </div>`).join('');
  wall.querySelectorAll('.spark').forEach((cv, i) => {
    const q = tiles[i].q;
    drawSpark(cv, q ? q._hist.slice(-20) : [tiles[i].price]);
  });
}

function drawSpark(canvas, data) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!data.length) return;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const up = data[data.length - 1] >= data[0];
  ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
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
  const qty = parseInt(document.getElementById('fh-qty').value) || 0;
  const cost = parseFloat(document.getElementById('fh-cost').value) || 0;
  if (!code || !qty) return alert('請填入代號與股數');
  const idx = holdings.findIndex(h => h.code === code);
  const today = new Date().toISOString().slice(0, 10);
  if (idx >= 0) {
    const old = holdings[idx];
    const newQty = old.qty + qty;
    old.cost = newQty ? (old.cost * old.qty + cost * qty) / newQty : cost;
    old.qty = newQty;
    txns.push({ code, name: old.name, qty, price: cost, date: today, side: qty >= 0 ? 'buy' : 'sell' });
  } else {
    holdings.push({ code, name: name || code, qty, cost });
    txns.push({ code, name: name || code, qty, price: cost, date: today, side: 'buy' });
  }
  save(LS.holdings, holdings); save(LS.txns, txns);
  document.getElementById('add-holding-form').classList.add('hidden');
  renderPortfolio(); renderPnl();
});

function renderPortfolio() {
  const tbody = document.getElementById('portfolio-body');
  const totalValue = holdings.reduce((s, h) => s + (quoteMap[h.code] ? quoteMap[h.code].price : h.cost) * h.qty, 0);
  tbody.innerHTML = holdings.map((h, i) => {
    const q = quoteMap[h.code];
    const price = q ? q.price : h.cost;
    const pnl = (price - h.cost) * h.qty;
    const pnlPct = h.cost ? (price - h.cost) / h.cost : 0;
    const share = totalValue ? (price * h.qty) / totalValue : 0;
    return `<tr>
      <td>${h.code}</td><td>${h.name}</td><td>${h.qty}</td>
      <td>${fmt(h.cost)}</td><td class="${cls(pnlPct)}">${fmt(price)}</td>
      <td class="${cls(pnl)}">${pnl >= 0 ? '+' : ''}${fmt(pnl)} (${pctFmt(pnlPct)})</td>
      <td>${(share * 100).toFixed(1)}%</td>
      <td><button class="del-btn" data-i="${i}" title="移除">×</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.i);
      const h = holdings[i];
      holdings.splice(i, 1);
      txns.push({ code: h.code, name: h.name, qty: -h.qty, price: quoteMap[h.code] ? quoteMap[h.code].price : h.cost, date: new Date().toISOString().slice(0, 10), side: 'sell' });
      save(LS.holdings, holdings); save(LS.txns, txns);
      renderPortfolio(); renderPnl();
    });
  });

  const txnEl = document.getElementById('transactions');
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
  const code = document.getElementById('fd-code').value.trim();
  const name = document.getElementById('fd-name').value.trim();
  const qty = parseInt(document.getElementById('fd-qty').value) || 0;
  const amount = parseFloat(document.getElementById('fd-amount').value) || 0;
  const date = document.getElementById('fd-date').value || new Date().toISOString().slice(0, 10);
  if (!code || !qty) return alert('請填入代號與股數');
  dividends.push({ code, name: name || code, qty, amount, date });
  save(LS.dividends, dividends);
  document.getElementById('add-dividend-form').classList.add('hidden');
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
  el.innerHTML = dividends.length ? dividends.slice().reverse().map((d, i) => `
    <div class="div-item">
      <span><strong>${d.code}</strong> ${d.name} · ${d.qty} 股 × ${fmt(d.amount)} <span style="color:var(--muted);font-size:12px">${d.date}</span></span>
      <span class="total">+${fmt(d.qty * d.amount)}</span>
    </div>`).join('') : '<div style="color:var(--muted);padding:20px;text-align:center">尚無股息紀錄</div>';
  el.querySelectorAll('.div-item').forEach((item, i) => {
    // no delete button for now
  });
}

// ---------- Analysis ----------
function drawAnalysis() {
  const canvas = document.getElementById('analysis-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const data = quotes[0]._hist; // TAIEX
  if (!data.length) return;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const up = data[data.length - 1] >= data[0];
  ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 20 - ((v - min) / range) * (h - 40);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  // grid lines
  ctx.strokeStyle = '#2a3042'; ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h - 40) * i / 4 + 20;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // metrics
  const t = quotes[0];
  const vwap = data.reduce((s, v) => s + v, 0) / data.length;
  const dayRange = (t.high - t.low) / t.open;
  document.getElementById('analysis-metrics').innerHTML = `
    <div class="metric"><div class="label">加權開盤</div><div class="value">${fmt(t.open)}</div></div>
    <div class="metric"><div class="label">現價</div><div class="value ${cls(t.pctChg)}">${fmt(t.price)}</div></div>
    <div class="metric"><div class="label">日區間</div><div class="value">${fmt(t.low)} – ${fmt(t.high)}</div></div>
    <div class="metric"><div class="label">VWAP（模擬）</div><div class="value">${fmt(vwap)}</div></div>
    <div class="metric"><div class="label">日波動度</div><div class="value">${(dayRange * 100).toFixed(2)}%</div></div>`;

  document.getElementById('analysis-notes').innerHTML =
    `<strong style="color:var(--text)">市場解讀（模擬數據）</strong><br>` +
    `• 加權指數開盤 <b>${fmt(t.open)}</b>，現價 <b class="${cls(t.pctChg)}">${fmt(t.price)}</b>（${pctFmt(t.pctChg)}）。<br>` +
    `• 日內波動區間 ${fmt(t.low)}–${fmt(t.high)}，區間幅度 ${(dayRange*100).toFixed(2)}%。<br>` +
    `• 0050 持倉 ${holdings.find(h=>h.code==='0050')?.qty ?? 0} 股，成本 ${fmt(holdings.find(h=>h.code==='0050')?.cost ?? 0)}。`;
}

// ---------- Tick loop ----------
let lastFullRender = 0;
setInterval(() => {
  quotes.forEach(q => q.tick());
  const now = Date.now();
  if (document.getElementById('tab-live').classList.contains('active')) renderLive();
  if (document.getElementById('tab-pnl').classList.contains('active')) renderPnl();
  if (document.getElementById('tab-portfolio').classList.contains('active')) renderPortfolio();
  if (document.getElementById('tab-analysis').classList.contains('active') && now - lastFullRender > 5000) {
    drawAnalysis(); lastFullRender = now;
  }
}, 2000);

// ---------- Init ----------
renderLive(); renderPnl(); renderPortfolio(); renderDividends();
})();
