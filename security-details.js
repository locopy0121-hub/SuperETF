// Accessible stock/ETF details, with explicit TWSE dates and unavailable fields.
(function(){
'use strict';
const app=globalThis.SuperETFAppAPI,twse=globalThis.SuperETFTWSE;
const dialog=document.getElementById('security-detail-dialog');
const body=document.getElementById('security-detail-content');
const grid=document.getElementById('live-grid');
if(!app||!twse||!dialog||!body||!grid)return;
let selected=null,serial=0;
function elt(tag,css,text){
 const n=document.createElement(tag);
 if(css)n.className=css;
 if(text!=null)n.textContent=String(text);
 return n;
}
function positive(n){return n!=null&&Number.isFinite(Number(n));}
function fmt(value,digits=2){
 return !positive(value)?'—':Number(value).toLocaleString('zh-TW',{
  minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function stamp(value){
 if(!value)return '未取得';
 return new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
}
function pair(group,label,value){
 const cell=elt('div','security-stat');
 cell.append(elt('div','security-stat-label',label),
  elt('div','security-stat-value',value==null||value===''?'—':value));
 group.append(cell);
}
function section(title){
 body.append(elt('h3','security-section-title',title));
 const grid=elt('div','security-stat-grid');body.append(grid);return grid;
}
function rawFields(grid,row){
 if(!row||typeof row!=='object')return 0;
 let count=0;
 for(const [key,value] of Object.entries(row)){
  if(value==null||value===''||typeof value==='object'||/密碼|token|api.?key/i.test(key))continue;
  if(count>=50)break;
  pair(grid,key,value);count++;
 }
 return count;
}
function render(code){
 const q=app.getQuote(code);
 if(!q)return;
 selected=code;body.replaceChildren();
 const official=q.officialRow??null;
 const marketOpen=app.getIsMarketOpen();
 const name=elt('div','security-code',q.code+' · '+(q.type==='index'?'指數':q.type==='etf'?'ETF':'個股'));
 body.append(name);
 const title=elt('h2','security-detail-name',q.name);body.append(title);
 const source=q.dataSource==='twse'?'TWSE 官方收盤':
  q.dataSource==='live'?'富果 WebSocket LIVE（盤中）':
  q.dataSource==='fuguo'?'富果 REST；待 TWSE 官方核對':
  q.dataSource==='yahoo'?'Yahoo 備援；非官方資料':'尚無有效報價';
 body.append(elt('div','security-source',source));
 const price=elt('div','security-price',fmt(q.price));
 price.classList.add(q.pctChg>0?'up':q.pctChg<0?'down':'flat');body.append(price);
 body.append(elt('p','security-source','官方交易日期：'+(q.officialDate||'尚未確認')+
  (marketOpen?' · 盤中行情非最終收盤':' · 資料需與官方交易日期相符')));
 const quote=section('行情與收盤數據');
 const change=official?.change??(q.previousClose>0&&positive(q.price)?q.price-q.previousClose:null);
 pair(quote,'現價／最後有效價格',fmt(q.price));
 pair(quote,'TWSE 官方收盤',fmt(official?.close));
 pair(quote,'漲跌價差',fmt(change));
 pair(quote,'漲跌幅',positive(q.price)&&positive(q.previousClose)&&q.previousClose>0?fmt(q.pctChg*100)+'%':'—');
 pair(quote,'開盤',fmt(official?.open??q.open));
 pair(quote,'最高',fmt(official?.high??q.high));
 pair(quote,'最低',fmt(official?.low??q.low));
 pair(quote,'昨收／參考價',fmt(official?.previousClose??q.previousClose));
 pair(quote,'成交股數（股）',fmt(official?.volume??q.volume,0));
 pair(quote,'成交金額（元）',fmt(official?.turnover??q.turnover,0));
 pair(quote,'成交筆數',fmt(official?.trades??q.trades,0));
 pair(quote,'收盤核定來源',q.officialDate?'TWSE '+q.officialDate:'尚待官方核定');
 pair(quote,'最後接收時間',stamp(q.updatedAt));
 const holdings=app.getHoldings().filter(x=>x.code===code);
 const quantity=holdings.reduce((n,h)=>n+Number(h.qty||0),0);
 const cost=holdings.reduce((n,h)=>n+Number(h.qty||0)*Number(h.cost||0),0);
 const owned=section('持股與損益');
 pair(owned,'持有股數',fmt(quantity,0));pair(owned,'總成本',fmt(cost));
 pair(owned,'平均成本',quantity>0?fmt(cost/quantity):'—');
 pair(owned,'市值',quantity>0&&q.hasReal?fmt(quantity*q.price):'—');
 pair(owned,'未實現損益',quantity>0&&q.hasReal?fmt(quantity*q.price-cost):'—');
 const txs=app.getTransactions().filter(x=>x.code===code).slice(-12).reverse();
 const trades=section('最近交易紀錄（最多 12 筆）');
 if(!txs.length)pair(trades,'交易紀錄','尚無');
 for(const x of txs)pair(trades,x.date+' '+(x.side==='sell'?'賣出':'買入'),
   fmt(x.qty,0)+' 股 @ '+fmt(x.price));
 const divs=app.getDividends().filter(x=>x.code===code).slice(-12).reverse();
 const dividends=section('股息紀錄（最多 12 筆）');
 if(!divs.length)pair(dividends,'股息紀錄','尚無');
 for(const x of divs)pair(dividends,x.date,fmt(x.qty,0)+' 股 × '+fmt(x.amount));
 body.append(elt('h3','security-section-title','官方基本資料與財務指標'));
 const fundamentals=elt('div','security-stat-grid');fundamentals.id='security-fundamentals';
 body.append(fundamentals);
 const wait=elt('p','security-source','查詢 TWSE 基本資料中…');fundamentals.append(wait);
 const foot=elt('div','security-detail-links');
 for(const [name,url] of [
  ['TWSE 個股歷史交易','https://www.twse.com.tw/zh/trading/historical/stock-day.html'],
  ['TWSE ETF 日成交','https://www.twse.com.tw/zh/products/securities/etf/trading/statistics/day.html']
 ]){
  const a=elt('a','',name);a.href=url;a.target='_blank';a.rel='noopener noreferrer';foot.append(a);
 }
 body.append(foot);
 return fundamentals;
}
async function open(code){
 if(!app.getQuote(code))return;
 const token=++serial;
 const target=render(code);
 if(!dialog.open)dialog.showModal();
 try{
  const {ratios,company,fund}=await twse.loadFundamentals(code);
  if(token!==serial||selected!==code||!dialog.open)return;
  target.replaceChildren();
  if(ratios){
   pair(target,'評價日期',ratios.date||'—');
   pair(target,'本益比',fmt(ratios.pe));
   pair(target,'殖利率',positive(ratios.yieldPct)?fmt(ratios.yieldPct)+'%':'—');
   pair(target,'股價淨值比',fmt(ratios.pb));
  }
  const count=rawFields(target,company||fund);
  if(!ratios&&!count)target.append(elt('p','security-source',
   'TWSE 尚無可用基本資料。部分 ETF、上櫃或剛上市標的可能不適用此資料表。'));
 }catch(error){
  if(token===serial)target.replaceChildren(elt('p','security-source','官方基本資料查詢失敗，請稍後再試'));
 }
}
grid.addEventListener('click',event=>{
 const button=event.target.closest('.live-card[data-code]');
 if(button&&grid.contains(button))void open(button.dataset.code);
});
document.getElementById('security-detail-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
dialog.addEventListener('close',()=>{selected=null;serial++;});
})();
