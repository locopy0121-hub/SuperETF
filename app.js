(() => {
'use strict';

const VERSION = '1.4.6';
const FugleAPI = globalThis.SuperETFFugleAPI;
if (!FugleAPI) throw new Error('富果 API 工具未載入');
const LiveEngine = globalThis.SuperETFLive;
if (!LiveEngine) throw new Error('富果 LIVE 串流核心未載入');
const SecurityLookup = globalThis.SuperETFSecurityLookup;
if (!SecurityLookup) throw new Error('證券名稱查詢工具未載入');
const TWSE = globalThis.SuperETFTWSE;
if (!TWSE) throw new Error('TWSE 官方收盤資料工具未載入');

// ---------- API 設定（存於 localStorage，由「設置」tab 管理）----------
const LS_API  = 'setf_api_config';
const API_DEFAULTS = {
  fuguo: {
    enabled:  false,
    baseUrl:  FugleAPI.REST_BASE,
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
        baseUrl:  saved?.fuguo?.baseUrl  || FugleAPI.REST_BASE,
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
  { code: '^TWSE',  name: '加權指數',     type: 'index', base: 23500, drift: 0.001,  yahoo: '^TWII'   },
  { code: '0050',   name: '元大50',       type: 'etf',   base: 18.35, drift: 0.0005, yahoo: '0050.TW'  },
  { code: '0056',   name: '元大高股息',       type: 'etf',   base: 31.50, drift: 0.0004, yahoo: '0056.TW'  },
  { code: '2884',   name: '玉山金',         type: 'stock', base: 42.50, drift: 0.0008, yahoo: '2884.TW'  },
  { code: '2330',   name: '台積電',       type: 'stock', base: 1010,  drift: 0.0004, yahoo: '2330.TW'  },
  { code: '6605',   name: '帝寶',       type: 'stock', base: 485,   drift: 0.0009, yahoo: '6605.TW'  },
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
    this.open = null;
    this.price = null;
    this.base = base; this.drift = drift;
    this.high = null; this.low = null;
    this._hist = [];
    this.dataSource = 'none';
    this.updatedInCycle = false;
    this.hasReal = false;
    this.previousClose = null;
    this.priceKind = 'mock';
  }
  tick() { /* Never synthesize prices. */ }
  applyReal(price, open, details = {}) {
    if (!Number.isFinite(price) || price <= 0) return;
    if (!this.hasReal) this._hist = [];
    this.high = Number.isFinite(details.high) && details.high>0 ? details.high :
      (Number.isFinite(this.high) ? Math.max(this.high,price) : price);
    this.low = Number.isFinite(details.low) && details.low>0 ? details.low :
      (Number.isFinite(this.low) ? Math.min(this.low,price) : price);
    if (Number.isFinite(open) && open>0) this.open = open;
    this.price = price;
    this.previousClose = details.previousClose ?? this.previousClose;
    this.priceKind = details.kind ?? 'trade';
    this.hasReal = true;
    this.dataSource = details.source || 'fuguo';
    this.updatedAt = Date.now();
    this.updatedInCycle = true;
    this._hist.push(price); if (this._hist.length>60) this._hist.shift();
  }
  get pctChg() {
    const base = this.previousClose > 0 ? this.previousClose : this.open;
    return base > 0 && Number.isFinite(this.price) ? (this.price - base) / base : 0;
  }
}

const quotes   = SEED_QUOTES.map(q => new Quote(q));
const quoteMap = Object.fromEntries(quotes.map(q => [q.code, q]));
function fugleSymbol(code) {
  // Legacy settings sometimes mapped the price index to the TRI (IR0001).
  // ^TWSE must always mean the TAIEX price index IX0001.
  if (code === '^TWSE') return 'IX0001';
  return FugleAPI.normalizeSymbol(apiCfg.fuguo.symbols?.[code] || code);
}
function ensureHoldingQuote(h) {
  const code = String(h.code || '').trim().toUpperCase();
  if (!code || quoteMap[code]) return;
  try { FugleAPI.normalizeSymbol(code); } catch { return; }
  const type=/^00[0-9]{2,4}[A-Z]?$/.test(code)||/ETF/i.test(String(h.name||''))?'etf':'stock';
  const q = new Quote({code, name:String(h.name || code), type, base:0, drift:0, yahoo:code+'.TW'});
  quotes.push(q); quoteMap[code] = q;
}
holdings.forEach(ensureHoldingQuote);

function fmt(n,digits=2) {
  return n==null || !Number.isFinite(Number(n)) ? '—' :
    Number(n).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function esc(s) {
  return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pctFmt(p) { return (p >= 0 ? '+' : '') + (p * 100).toFixed(2) + '%'; }
// Taiwan stock convention: red = rising, green = falling, yellow = unchanged.
const PNL_COLORS=Object.freeze({up:'#ef4444',down:'#22c55e',flat:'#facc15'});
function cls(p) {
  if(p==null||!Number.isFinite(Number(p)))return 'unknown';
  return p>1e-9?'up':p< -1e-9?'down':'flat';
}
function pnlStroke(change) { return PNL_COLORS[cls(change)]||'#8b92a8'; }

// ============================================================
// MarketData service — 富果API 主 / Yahoo 備 / 離線模擬兜底
// ============================================================
const SOURCE_LABELS = {
  live: '● LIVE 富果',
  fuguo: '來源：富果 REST',
  twse: '收盤：TWSE 官方核對',
  fuguo_waiting: '富果 API 已連線（尚無行情）',
  yahoo: '來源：Yahoo Finance',
  mock:  '無可用行情（不使用模擬價）',
};

let liveClient = null;
let pendingLivePaint = false;
function paintQuotePanels() {
  if (pendingLivePaint) return;
  pendingLivePaint = true;
  requestAnimationFrame(() => {
    pendingLivePaint = false;
    if (document.getElementById('tab-live')?.classList.contains('active')) renderLive();
    if (document.getElementById('tab-pnl')?.classList.contains('active')) renderPnl();
    if (document.getElementById('tab-portfolio')?.classList.contains('active')) renderPortfolio();
    if (document.getElementById('tab-analysis')?.classList.contains('active')) drawAnalysis();
  });
}
function paintMarketStatus() {
  const badge=document.getElementById('data-source-badge');
  const time=document.getElementById('last-updated');
  const stream=liveClient?.status()||{state:'disabled',reason:''};
  const state=stream.state;
  let label=SOURCE_LABELS[MarketData.source] || MarketData.source;
  let style=MarketData.source;
  if(state==='live') {
    label='● LIVE 富果 WebSocket';style='live';
  } else if(['connecting','authenticating','subscribing'].includes(state)) {
    label='LIVE 連線中';style='connecting';
  } else if(state==='reconnecting') {
    label='LIVE 重連中 · REST 備援';style='waiting';
  } else if(state==='capacity-wait') {
    label='LIVE 連線額度已滿 · 非 LIVE';style='waiting';
  } else if(state==='auth-error') {
    label='LIVE 金鑰遭拒 · REST 備援';style='waiting';
  } else if(state==='permission-error') {
    label='LIVE 串流權限不足 · REST 備援';style='waiting';
  } else if(state==='subscribed') {
    label='LIVE 訂閱成功 · 等待成交';style='connecting';
  } else if(!isMarketOpen() && quotes.some(q=>q.dataSource==='twse')) {
    label='TWSE 官方收盤';style='twse';
  } else if(isMarketOpen()&&apiCfg.fuguo.enabled&&apiCfg.fuguo.apiKey) {
    label='富果 REST 備援（非 LIVE）';style='waiting';
  }
  if(badge){badge.textContent=label;badge.className='source-badge '+style;}
  const detail=document.getElementById('live-connection-detail');
  if(detail)detail.textContent=isMarketOpen()?(stream.reason||''):(officialStatus||'收盤後依 TWSE 核對');
  const diagnostics=document.getElementById('live-diagnostics');
  if(diagnostics){
    const rows=[
      '串流狀態：'+state,
      '目前原因：'+(stream.reason||'無'),
      '連線嘗試：'+(stream.attempts||0),
      '下一次受控重試：'+(stream.nextRetryAt&&stream.nextRetryAt>Date.now()?new Date(stream.nextRetryAt).toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'}):'無'),
      '連線限制：同一 API Key 的 TF Asset、其他 App 或裝置可能占用名額。',
      '已訂閱頻道：'+(stream.subscriptions||0),
      '正在確認：'+(stream.pending||'無'),
      '最後伺服器錯誤：'+(stream.lastError||'無'),
      '最後 WSS 關閉碼：'+(stream.lastCloseCode??'無'),
      '隔離失敗：'+((stream.failed||[]).map(x=>x.symbol+'（'+x.reason+'）').join('、')||'無'),
      'REST 最近快照：'+(MarketData.lastUpdated?new Date(MarketData.lastUpdated).toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'}):'無')
    ];
    diagnostics.textContent=rows.join('\n');
  }
  if(time){
    const tick=state==='live'&&stream.lastTick?stream.lastTick:null;
    const last=tick||MarketData.lastUpdated;
    const mode=tick?'LIVE 最新成交':!isMarketOpen()&&MarketData.source==='twse'?'TWSE 官方收盤核對於':'REST 最新快照';
    time.textContent=last?mode+' '+new Date(last).toLocaleTimeString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'}):'等待行情';
  }
}
const MarketData = {
  source: 'mock',
  lastUpdated: 0,
  lastFugleError: '',
  lastFugleHttp200: 0,
  lastFugleNoPrice: 0,

  setSource(name) {
    this.source=name;
    paintMarketStatus();
    updateSourcePriorityBadges();
  },

  // REST v1.0：合法路由與金鑰標頭，逐檔隔離 404。
  async fetchFuguo(targets=quotes) {
    const f = apiCfg.fuguo;
    if (!f.enabled || !f.apiKey) return 0;
    this.lastFugleError = '';
    this.lastFugleHttp200 = 0;
    this.lastFugleNoPrice = 0;
    let base;
    try { base = FugleAPI.normalizeRestBase(f.baseUrl); }
    catch (e) { this.lastFugleError = e.message; return 0; }

    const responses = await Promise.all(targets.map(async q => {
      const startedAt=Date.now();
      const symbol = fugleSymbol(q.code);
      try {
        const url = FugleAPI.buildQuoteUrl(base, symbol);
        const r = await fetch(url, {
          headers: { 'X-API-KEY': f.apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(9000),
        });
        if (!r.ok) throw new Error(FugleAPI.httpError(r.status, q.code));
        const data = await r.json();
        const value = FugleAPI.parseQuote(data);
        return { q, data, value, startedAt };
      } catch (e) {
        if (!this.lastFugleError) this.lastFugleError = e.message;
        console.warn('[SuperETF] 富果報價失敗：' + q.code + '：' + e.message);
        return null;
      }
    }));
    this.lastFugleHttp200 = responses.filter(Boolean).length;
    const valid = responses.filter(item => item && item.value);
    this.lastFugleNoPrice = this.lastFugleHttp200 - valid.length;
    for (const {q, data, value, startedAt} of valid) {
      // Never let a delayed HTTP reply roll back a newer stream update.
      if((q.dataSource==='twse'&&!isMarketOpen())||
        (q.dataSource==='live'&&(liveClient?.isLive()||q.updatedAt>=startedAt)))continue;
      q.applyReal(value.price, value.open, {...value,source:'fuguo'});
      const record = data?.data && typeof data.data === 'object' ? data.data : data;
      if (typeof record.name === 'string' && record.name) q.name = record.name;
    }
    return valid.length;
  },

  // Fallback only for instruments not updated from Fugle this cycle.
  async fetchYahoo(targets=quotes) {
    const responses=await Promise.all(targets.map(async q=>{
      const startedAt=Date.now();
      try {
        const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(q.yahooSymbol)+'?interval=1d&range=5d';
        const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
        if(!r.ok)return null;
        const meta=(await r.json())?.chart?.result?.[0]?.meta;
        const price=Number(meta?.regularMarketPrice??meta?.chartPreviousClose);
        if(!Number.isFinite(price)||price<=0)return null;
        const open=Number(meta.regularMarketOpen??meta.chartPreviousClose)||price;
        const prev=Number(meta.chartPreviousClose??meta.previousClose);
        return {q,price,open,prev:Number.isFinite(prev)&&prev>0?prev:null,startedAt};
      }catch(e){console.warn('[SuperETF] Yahoo '+q.code+': '+e.message);return null;}
    }));
    const valid=responses.filter(Boolean);
    valid.forEach(v=>{
      if((v.q.dataSource==='twse'&&!isMarketOpen())||
        (v.q.dataSource==='live'&&(liveClient?.isLive()||v.q.updatedAt>=v.startedAt)))return;
      v.q.applyReal(v.price,v.open,{kind:'close',previousClose:v.prev,source:'yahoo'});
    });
    return valid.length;
  },
  async sync() {
    quotes.forEach(q=>{q.updatedInCycle=false;});
    const fu=await this.fetchFuguo();
    const yh=await this.fetchYahoo(quotes.filter(q=>!q.updatedInCycle && !(liveClient?.isLive() && q.dataSource==='live')));
    if(fu||yh){this.lastUpdated=Date.now();this.setSource(!isMarketOpen()&&quotes.some(q=>q.dataSource==='twse')?'twse':fu?'fuguo':'yahoo');return this.source;}
    if(this.lastFugleHttp200){this.setSource('fuguo_waiting');return 'fuguo_waiting';}
    this.setSource('mock');return 'mock';
  },
};


let officialStatus='';
let officialLastCheck=0, officialPending=null;
async function refreshOfficialClose(force=false){
  if(isMarketOpen())return; // Night/early morning uses last completed TWSE session.
  if(officialPending)return officialPending;
  if(!force&&Date.now()-officialLastCheck<300000)return;
  officialLastCheck=Date.now();
  officialPending=(async()=>{
    try{
      const result=await TWSE.loadOfficial();
      const today=TWSE.taipeiParts().date;
      let applied=0;
      for(const [code,record] of result.records){
        const q=quoteMap[code];
        if(!q || (q.dataSource==='twse'&&q.officialDate===record.date))continue;
        q.applyReal(record.close,record.open,{source:'twse',kind:'close',
          high:record.high,low:record.low,previousClose:record.previousClose??q.previousClose});
        q.name=record.name||q.name;
        q.officialDate=record.date;q.officialRow=record;
        q.volume=record.volume;q.turnover=record.turnover;q.trades=record.trades;
        applied++;
      }
      if(result.records.size){
        officialStatus='TWSE 官方收盤交易日 '+(result.latestStockDate||result.latestIndexDate||today);
        if(quotes.some(q=>q.dataSource==='twse'))MarketData.setSource('twse');
      }else{
        const old=result.latestStockDate||result.latestIndexDate;
        officialStatus=old&&old!==today?'TWSE 尚未公告當日收盤（目前最新 '+old+'）':
          'TWSE 官方收盤資料待取得'+(result.errors.length?'（網路可能受限）':'');
      }
      if(applied){MarketData.lastUpdated=Date.now();paintQuotePanels();}
    }catch(error){officialStatus='TWSE 查詢失敗，顯示最後有效報價';}
    finally{
      const el=document.getElementById('official-close-status');
      if(el)el.textContent=officialStatus;
      officialPending=null;
    }
  })();
  return officialPending;
}

// Fugle socket delivers every trade; REST is bootstrap and degraded fallback.
let marketSyncPending=false;
let lastRestSync=0;
async function marketLoop() {
  if(marketSyncPending)return;
  marketSyncPending=true;lastRestSync=Date.now();
  try {
    await MarketData.sync();
    if(!isMarketOpen())await refreshOfficialClose();
    paintQuotePanels();
  } catch(e){
    console.warn('[SuperETF] REST fallback error:',e.message);
  } finally {
    marketSyncPending=false;
    paintMarketStatus();
  }
}
function isMarketOpen() {
  return LiveEngine.taiwanTradingWindow();
}
function mayStream() {
  return isMarketOpen() && document.visibilityState!=='hidden' && (typeof navigator==='undefined'||navigator.onLine!==false);
}
function updateBadge() {
  const el=document.getElementById('session-badge');
  if(!el)return;
  if(isMarketOpen()){
    el.textContent=liveClient?.isLive()?'台股盤中 · LIVE':'台股一般交易時段';
    el.className='session-badge open';
  }else{
    el.textContent='非一般交易時段 · 顯示最後有效行情';
    el.className='session-badge closed';
  }
}
function streamInstruments(){
  // Follow TF Asset: one provider socket, prioritized holdings before sample quotes.
  const ordered=[...holdings.map(h=>quoteMap[h.code]).filter(Boolean),
    quoteMap['^TWSE'],...quotes].filter(Boolean);
  const used=new Set(),result=[];
  for(const q of ordered){
    if(String(q.name||'').includes('（待核對）'))continue;
    try{
      const symbol=fugleSymbol(q.code);
      const key=(q.type==='index'?'indices':'trades')+':'+symbol;
      if(used.has(key))continue;
      used.add(key);result.push({symbol,type:q.type});
    }catch(e){}
  }
  return result;
}
function onStreamQuote(update) {
  let changed=false;
  for(const q of quotes){
    let symbol;
    try{symbol=fugleSymbol(q.code);}catch(e){continue;}
    if(symbol!==update.symbol)continue;
    if(update.timestamp && q.lastMarketTs && update.timestamp<q.lastMarketTs)continue;
    const open=update.open??q.open??update.price;
    q.applyReal(update.price,open,{
      kind:update.kind,previousClose:update.previousClose??q.previousClose,
      high:update.high,low:update.low,source:'live'
    });
    if(update.timestamp)q.lastMarketTs=update.timestamp;
    if(update.name)q.name=update.name;
    changed=true;
  }
  if(!changed)return;
  MarketData.source='live';
  MarketData.lastUpdated=Date.now();
  paintMarketStatus();
  paintQuotePanels();
}
liveClient=LiveEngine.createLiveStream({
  getCredentials:()=>apiCfg.fuguo,
  getInstruments:streamInstruments,
  isMarketOpen:mayStream,
  onStatus:()=>{paintMarketStatus();updateBadge();},
  onQuote:onStreamQuote
});
let lastSession=isMarketOpen();
if(mayStream())liveClient.start(); // Single WebSocket, real tick -> immediate UI repaint.
void marketLoop(); // One initial snapshot for previous close and open.
setInterval(()=>{
  const during=isMarketOpen();
  if(during){
    if(mayStream()){
      liveClient.start();
      const minDelay=liveClient.isLive()?180000:30000;
      if(Date.now()-lastRestSync>=minDelay)void marketLoop();
    }else if(!['idle','disabled'].includes(liveClient.status().state)){
      liveClient.stop('background');
    }
  }else{
    if(lastSession){
      liveClient.stop();
      void marketLoop(); // TWSE date must match current trading session.
    } else if(liveClient.status().state!=='idle'&&liveClient.status().state!=='disabled'){
      liveClient.stop();
    }
  }
  if(!during)void refreshOfficialClose();
  lastSession=during;
  updateBadge();
  paintMarketStatus();
},5000);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    liveClient.stop('background'); // Return the server connection slot to other Apps.
  }else if(mayStream()){
    liveClient.start();
    void marketLoop();
  }else if(document.visibilityState==='visible'){
    void refreshOfficialClose(true);
  }
  updateBadge();paintMarketStatus();
});
window.addEventListener('pagehide',()=>liveClient.stop('background'));
window.addEventListener('online',()=>{if(mayStream())liveClient.start();});
window.addEventListener('offline',()=>{liveClient.stop('offline');paintMarketStatus();});

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
    const kindLabel = q.hasReal
      ? ({reference: '參考', previous: '昨收', trial: '試撮'})[q.priceKind] || ''
      : '';
    const liveNow=q.dataSource==='live' && liveClient?.isLive()
      && Date.now()-(q.updatedAt||0)<90000;
    const quoteTag=liveNow ? ' · LIVE' : q.dataSource==='twse' ? ' · TWSE '+(q.officialDate||'') : q.dataSource==='live' ? ' · 最後 LIVE 價' : '';
    return `<button type="button" class="live-card" data-code="${esc(q.code)}" aria-label="查看 ${esc(q.name)} 完整資料">
      <div class="code"><span>${esc(q.code.replace('^',''))}</span><span>${typeLabel}</span></div>
      <div class="name">${esc(q.name)}</div>
      <div class="price ${cls(q.hasReal?p:null)}">${fmt(q.price)}${kindLabel ? ' <small style="font-size:11px;color:var(--muted)">' + kindLabel + '</small>' : ''}</div>
      <div class="chg ${cls(q.hasReal?p:null)}">${q.hasReal ? q.dataSource==='twse'&&q.officialRow?.change==null?'漲跌無比價':pctFmt(p) : '等待行情'} <span style="color:var(--muted);font-size:11px">開 ${fmt(q.open)} · ${q.hasReal ? esc(q.dataSource)+quoteTag : "未取得"}</span></div>
    </button>`;
  }).join('');
}

// ---------- PnL wall ----------
function renderPnl() {
  const summary=document.getElementById('pnl-summary'),wall=document.getElementById('pnl-wall');
  let totalCost=0,totalValue=0,covered=0;
  const rows=holdings.map(h=>{
    const q=quoteMap[h.code],real=!!q?.hasReal && Number.isFinite(q.price)&&q.price>0;
    const price=real?q.price:null,cost=h.cost*h.qty;
    const pnl=real?(price-h.cost)*h.qty:null;
    const pct=real&&h.cost>0?(price-h.cost)/h.cost:null;
    if(real){totalCost+=cost;totalValue+=price*h.qty;covered++;}
    return {h,q,price,pnl,pct};
  });
  const totalPnl=totalValue-totalCost,totalPct=totalCost?totalPnl/totalCost:0;
  summary.innerHTML=`<div class="pnl-box"><div class="label">有效行情市值</div><div class="value">NT$ ${fmt(totalValue)}</div></div>
    <div class="pnl-box"><div class="label">有效行情成本</div><div class="value">NT$ ${fmt(totalCost)}</div></div>
    <div class="pnl-box"><div class="label">已確認損益</div><div class="value ${cls(totalPct)}">${covered?(totalPnl>=0?'+':'')+fmt(totalPnl):'—'}</div></div>
    <div class="pnl-box"><div class="label">有效檔數</div><div class="value">${covered}/${holdings.length}</div></div>`;
  wall.innerHTML=rows.map(({h,q,price,pnl,pct})=>`<div class="pnl-tile">
    <div class="head"><span>${esc(h.code)} ${esc(h.name)}</span><span>${fmt(h.qty,0)} 股</span></div>
    <div class="pnl ${cls(pct)}">${pnl===null?'等待有效行情':(pnl>=0?'+':'')+fmt(pnl)+'（'+pctFmt(pct)+'）'}</div>
    <canvas class="spark" data-code="${esc(h.code)}" width="200" height="34"></canvas>
    <div style="font-size:11px;color:var(--muted)">現價 ${fmt(price)} · 成本 ${fmt(h.cost)} · ${q?.hasReal?esc(q.dataSource):'未取得'}</div>
  </div>`).join('');
  wall.querySelectorAll('.spark').forEach(cv=>{
    const q=quoteMap[cv.dataset.code],data=q?._hist.slice(-30)||[];
    if(data.length<2)return;
    const ctx=cv.getContext('2d');if(!ctx)return;
    const w=cv.width,height=cv.height,min=Math.min(...data),max=Math.max(...data),range=max-min||1;
    ctx.strokeStyle=pnlStroke(q.previousClose>0?q.price-q.previousClose:q.price-q.open);ctx.lineWidth=1.5;ctx.beginPath();
    data.forEach((v,i)=>{const x=i/(data.length-1)*w,y=height-2-((v-min)/range)*(height-4);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.stroke();
  });
}

// ---------- Auto-name lookup for holdings and dividends ----------
const symbolNameOptions=()=>({
  apiKey:apiCfg.fuguo.enabled?apiCfg.fuguo.apiKey:'',
  baseUrl:apiCfg.fuguo.baseUrl
});
const holdingNameLookup=SecurityLookup.bindCodeName({
  codeInput:document.getElementById('fh-code'),
  nameInput:document.getElementById('fh-name'),
  statusElement:document.getElementById('fh-name-status'),
  options:symbolNameOptions
});
const dividendNameLookup=SecurityLookup.bindCodeName({
  codeInput:document.getElementById('fd-code'),
  nameInput:document.getElementById('fd-name'),
  statusElement:document.getElementById('fd-name-status'),
  options:symbolNameOptions
});


// Update saved holding immediately, even outside Taiwan trading hours.
// TWSE EOD is authoritative when the latest session is confirmed; never synthesize prices.
const newHoldingRequests=new Map();
function refreshAllHoldingViews(){
  renderLive();renderPnl();renderPortfolio();renderDividends();
  if(document.getElementById('tab-analysis')?.classList.contains('active'))drawAnalysis();
  paintMarketStatus();
}
async function refreshNewHoldingQuote(code){
  if(newHoldingRequests.has(code))return newHoldingRequests.get(code);
  const q=quoteMap[code],status=document.getElementById('holding-sync-status');
  if(!q)return;
  if(status)status.textContent=code+' 已儲存，正在更新行情與損益…';
  const promise=(async()=>{
    try{
      if(!isMarketOpen())await refreshOfficialClose(true);
      if(!q.hasReal&&apiCfg.fuguo.enabled&&apiCfg.fuguo.apiKey)await MarketData.fetchFuguo([q]);
      if(!q.hasReal)await MarketData.fetchYahoo([q]);
      if(isMarketOpen()&&mayStream())liveClient.refreshSubscriptions();
      if(q.hasReal){
        if(['mock','fuguo_waiting'].includes(MarketData.source))MarketData.setSource(q.dataSource);
        if(status)status.textContent=code+' 行情已更新（'+q.dataSource+'）';
      }else if(status)status.textContent=code+' 已儲存；目前尚無有效報價，等待行情來源更新';
    }catch(error){
      if(status)status.textContent=code+' 已儲存；行情暫時無法取得';
    }finally{
      newHoldingRequests.delete(code);
      refreshAllHoldingViews();
    }
  })();
  newHoldingRequests.set(code,promise);
  return promise;
}

// ---------- Portfolio ----------
document.getElementById('btn-add-holding').addEventListener('click', () => {
  document.getElementById('add-holding-form').classList.toggle('hidden');
});
document.getElementById('fh-cancel').addEventListener('click', () => {
  holdingNameLookup.reset();
  document.getElementById('add-holding-form').classList.add('hidden');
});
document.getElementById('fh-save').addEventListener('click', async () => {
  const code = SecurityLookup.codeOf(document.getElementById('fh-code').value);
  let name = document.getElementById('fh-name').value.trim();
  const qty  = parseInt(document.getElementById('fh-qty').value)   || 0;
  const cost = parseFloat(document.getElementById('fh-cost').value) || 0;
  if(!SecurityLookup.isValid(code)||!(qty>0)||!Number.isFinite(cost)||cost<0)
    return alert('請確認代號、股數與非負成本');
  if(!name){
    const hit=await holdingNameLookup.resolveNow();
    if(SecurityLookup.codeOf(document.getElementById('fh-code').value)!==code)return;
    name=document.getElementById('fh-name').value.trim()||hit?.name||'';
    if(!name)return alert('尚未取得證券名稱，請手動輸入後再保存');
  }
  const item={code,name,qty,cost};
  holdings.push(item);
  ensureHoldingQuote(item);
  txns.push({code:item.code,name:item.name,qty,price:cost,side:'buy',
    date:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'})});
  save(LS.txns,txns);
  save(LS.holdings,holdings);
  document.getElementById('add-holding-form').classList.add('hidden');
  ['fh-code','fh-name','fh-qty','fh-cost'].forEach(id=>document.getElementById(id).value='');
  holdingNameLookup.reset();
  refreshAllHoldingViews();
  liveClient.refreshSubscriptions();
  void refreshNewHoldingQuote(code);
});

function renderPortfolio() {
  const body=document.getElementById('portfolio-body');
  const total=holdings.reduce((s,h)=>{const q=quoteMap[h.code];return s+(q?.hasReal?q.price*h.qty:0);},0);
  body.innerHTML=holdings.map((h,i)=>{
    const q=quoteMap[h.code],price=q?.hasReal?q.price:null;
    const value=price===null?null:price*h.qty,pnl=value===null?null:value-h.cost*h.qty;
    const pct=value!==null&&total>0?value/total:null;
    return `<tr><td><strong>${esc(h.code)}</strong></td><td>${esc(h.name)}</td>
      <td>${fmt(h.qty,0)}</td><td>${fmt(h.cost)}</td><td class="${cls(q?.hasReal?q.pctChg:null)}">${fmt(price)}</td>
      <td class="${cls(pnl)}">${pnl===null?'—':(pnl>=0?'+':'')+fmt(pnl)}</td>
      <td>${pct===null?'—':(pct*100).toFixed(1)+'%'}</td>
      <td><button class="del-btn" data-i="${i}" title="移除">×</button></td></tr>`;
  }).join('');
  body.querySelectorAll('.del-btn').forEach(b=>b.addEventListener('click',()=>{
    const i=Number(b.dataset.i);if(!Number.isInteger(i)||i<0||i>=holdings.length)return;
    holdings.splice(i,1);
    save(LS.holdings,holdings);
    refreshAllHoldingViews();
    liveClient.refreshSubscriptions();
  }));
  renderTransactions();
}

function renderTransactions() {
  const txnEl = document.getElementById('transactions');
  if (!txnEl) return;
  txnEl.innerHTML = `<h3>交易紀錄（最新在前）</h3><div class="txn-list">` +
    [...txns].reverse().slice(0, 10).map(t => `
      <div class="txn-item">
        <span class="${t.side === 'buy' ? 'txn-buy' : 'txn-sell'}">${t.side === 'buy' ? '買入' : '賣出'} ${esc(t.code)} ${Math.abs(t.qty)} 股 @ ${fmt(t.price)}</span>
        <span class="date">${t.date}</span>
      </div>`).join('') + '</div>';
}

// ---------- Dividends ----------
document.getElementById('btn-add-dividend').addEventListener('click', () => {
  document.getElementById('add-dividend-form').classList.toggle('hidden');
});
document.getElementById('fd-cancel').addEventListener('click', () => {
  dividendNameLookup.reset();
  document.getElementById('add-dividend-form').classList.add('hidden');
});
document.getElementById('fd-save').addEventListener('click', async () => {
  const code   = SecurityLookup.codeOf(document.getElementById('fd-code').value);
  let name   = document.getElementById('fd-name').value.trim();
  const qty    = parseInt(document.getElementById('fd-qty').value)    || 0;
  const amount = parseFloat(document.getElementById('fd-amount').value) || 0;
  const date   = document.getElementById('fd-date').value || new Date().toISOString().slice(0, 10);
  if(!SecurityLookup.isValid(code)||!(qty>0)||!Number.isFinite(amount)||amount<0||!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return alert('請確認股息代號、股數、金額及日期');
  if(!name){
    const hit=await dividendNameLookup.resolveNow();
    if(SecurityLookup.codeOf(document.getElementById('fd-code').value)!==code)return;
    name=document.getElementById('fd-name').value.trim()||hit?.name||'';
    if(!name)return alert('尚未取得證券名稱，請手動輸入後再保存');
  }
  dividends.push({ code, name, qty, amount, date });
  save(LS.dividends, dividends);
  document.getElementById('add-dividend-form').classList.add('hidden');
  ['fd-code','fd-name','fd-qty','fd-amount','fd-date'].forEach(id => document.getElementById(id).value = '');
  dividendNameLookup.reset();
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
        <span><strong>${esc(d.code)}</strong> ${esc(d.name)} · ${d.qty} 股 × ${fmt(d.amount)} <span style="color:var(--muted);font-size:12px">${d.date}</span></span>
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
  if(!data.length){document.getElementById('analysis-notes').textContent='尚無有效加權指數行情；不顯示模擬走勢。';return;}
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const movement=data[data.length-1]-data[0];

  ctx.strokeStyle = '#2a3042'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (h - 40) * i / 4 + 20;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = pnlStroke(movement);
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
    <div class="metric"><div class="label">近筆均價（非VWAP）</div><div class="value">${fmt(vwap)}</div></div>
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
  setVal('cfg-fuguo-baseurl',    (() => { try { return FugleAPI.normalizeRestBase(f.baseUrl); } catch { return f.baseUrl; } })());
  setVal('cfg-fuguo-key',        f.apiKey);
  setVal('cfg-fuguo-symbols',    Object.keys(f.symbols).length ? JSON.stringify(f.symbols, null, 2) : '');
  const chk = document.getElementById('cfg-fuguo-enabled');
  if (chk) chk.checked = f.enabled;
  updateSourcePriorityBadges();
}

function updateSourcePriorityBadges() {
  const fuBadge = document.getElementById('src-prio-fuguo');
  if (fuBadge) {
    if (apiCfg.fuguo.enabled && apiCfg.fuguo.apiKey) {
      fuBadge.textContent = '已設定';
      fuBadge.className   = 'source-badge fuguo';
    } else {
      const draft = document.getElementById('cfg-fuguo-enabled')?.checked &&
        document.getElementById('cfg-fuguo-key')?.value.trim();
      fuBadge.textContent = draft ? '待儲存' : '未設定';
      fuBadge.className = 'source-badge mock';
    }
  }
}

function parseSymbolsJson(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error();
    for (const [code, symbol] of Object.entries(obj)) {
      if (!quoteMap[code] || typeof symbol !== 'string') throw new Error();
      FugleAPI.normalizeSymbol(symbol);
    }
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
  let baseUrl;
  try { baseUrl = FugleAPI.normalizeRestBase(document.getElementById('cfg-fuguo-baseurl').value); }
  catch (e) { setFeedback('Base URL 錯誤：' + e.message, false); return; }
  const apiKey  = document.getElementById('cfg-fuguo-key').value.trim();
  if (enabled && !apiKey) { setFeedback('啟用富果 API 前請輸入 API Key', false); return; }
  let symbols = {};
  try {
    symbols = parseSymbolsJson(document.getElementById('cfg-fuguo-symbols').value);
  } catch (e) {
    setFeedback(e.message, false);
    return;
  }

  apiCfg = { fuguo: { enabled, baseUrl, apiKey, symbols } };
  saveApiConfig(apiCfg);
  liveClient.restart();

  const summary = enabled && baseUrl
    ? '已保存：富果API 已啟用，即時行情將優先使用富果來源'
    : '已保存：富果API 未啟用，即時行情將使用 Yahoo Finance';
  setFeedback(summary, true);
  updateSourcePriorityBadges();
  // 立即重新同步一次
  marketLoop().then(() => {
    const src=MarketData.source;
    const error = enabled && src !== 'fuguo' && !MarketData.lastFugleHttp200
      ? MarketData.lastFugleError : '';
    const idle = enabled && MarketData.lastFugleNoPrice > 0 ? '；部分代號 HTTP 200 但盤前尚無價格' : '';
    setFeedback(summary + '（目前來源：' + (SOURCE_LABELS[src] || src) + '）' +
      idle + (error ? '；富果診斷：' + error : ''), !error);
  });
});

document.getElementById('cfg-test').addEventListener('click', async () => {
  // 使用畫面上尚未保存的值，避免誤判測試的是舊設定。
  const input = document.getElementById('cfg-fuguo-baseurl').value;
  const key = document.getElementById('cfg-fuguo-key').value.trim();
  if (!key) { setFeedback('請先填入 API Key', false); return; }
  let url;
  try { url = FugleAPI.buildQuoteUrl(input, '0050'); }
  catch (e) { setFeedback('❌ ' + e.message, false); return; }
  setFeedback('測試中：富果 0050 標準報價路由…', true);
  try {
    const r = await fetch(url, { headers: { 'X-API-KEY': key, Accept: 'application/json' } });
    if (!r.ok) {
      setFeedback('❌ ' + FugleAPI.httpError(r.status, '0050') + '；URL：' + url, false);
      return;
    }
    const quote = FugleAPI.parseQuote(await r.json());
    const pending = apiCfg.fuguo.enabled ? '' : '；請按「保存設定」啟用自動更新';
    setFeedback('✅ 富果 API v1.0 ' + FugleAPI.quoteStatus(quote) + pending, true);
    updateSourcePriorityBadges();
  } catch (e) {
    setFeedback('❌ 網路或 CORS 問題：' + e.message, false);
  }
});

document.getElementById('cfg-live-retry')?.addEventListener('click',()=>{
  liveClient.restart();
  paintMarketStatus();
  updateBadge();
});

// ---------- Tick loop（離線模擬時啟用；有真實資料時跳過 random-walk） ----------
setInterval(() => {
  // Prices are fetched or streamed, never random-walked.
  if (document.getElementById('tab-live').classList.contains('active')) renderLive();
  if (document.getElementById('tab-pnl').classList.contains('active')) renderPnl();
  if (document.getElementById('tab-portfolio').classList.contains('active')) renderPortfolio();
  if (document.getElementById('tab-analysis').classList.contains('active')) drawAnalysis();
}, 2000);

// ---------- Init ----------
loadSettingsForm();
renderLive();renderPnl();renderPortfolio();renderDividends();
for(const [id,value] of [['version-sub','台股資產管理 v'+VERSION],['version-about','v'+VERSION],
 ['version-footer','SuperETF v'+VERSION+' · 主：富果API / 備：Yahoo Finance']]){
 const el=document.getElementById(id);if(el)el.textContent=value;
}
globalThis.SuperETFAppAPI={getQuote:code=>quoteMap[code]||null,
 getHoldings:()=>holdings,getDividends:()=>dividends,getTransactions:()=>txns,
 getIsMarketOpen:isMarketOpen};
console.log('SuperETF v'+VERSION);

})();
