// TWSE official after-close market data. Never confuse an older trading day with today's close.
(function(root){
'use strict';
const BASE='https://openapi.twse.com.tw/v1';
const URLS=Object.freeze({
 daily:BASE+'/exchangeReport/STOCK_DAY_ALL',
 index:BASE+'/exchangeReport/MI_INDEX',
 ratios:BASE+'/exchangeReport/BWIBBU_ALL',
 holidays:BASE+'/holidaySchedule/holidaySchedule',
 companies:BASE+'/opendata/t187ap03_L',
 funds:BASE+'/opendata/t187ap47_L'
});
const num=v=>{
 if(v==null||typeof v==='boolean'||String(v).trim()===''||String(v).trim()==='—')return null;
 const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?n:null;
};
const positive=v=>{const n=num(v);return n!=null&&n>0?n:null;};
function isoDate(raw){
 const v=String(raw??'').trim().replace(/\//g,'');
 if(/^\d{4}-\d{2}-\d{2}$/.test(v))return v;
 if(!/^\d{7}$/.test(v))return null;
 const year=Number(v.slice(0,3))+1911,month=Number(v.slice(3,5)),day=Number(v.slice(5,7));
 const iso=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
 return new Date(iso+'T00:00:00Z').toISOString().slice(0,10)===iso?iso:null;
}
function taipeiParts(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',
 month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=k=>parts.find(p=>p.type===k)?.value;
 return {date:[get('year'),get('month'),get('day')].join('-'),
  weekday:get('weekday'),minutes:Number(get('hour'))*60+Number(get('minute'))};
}
function eligibleDate(recordDate,now=new Date(),holidays=[]){
 const p=taipeiParts(now);
 if(!recordDate||recordDate>p.date)return false;
 const old=new Date(recordDate+'T00:00:00Z').getTime();
 const today=new Date(p.date+'T00:00:00Z').getTime();
 if(!Number.isFinite(old)||today-old>10*86400000)return false;
 const closed=p.weekday==='Sat'||p.weekday==='Sun'||holidays.includes(p.date);
 if(recordDate===p.date)return p.minutes>=13*60+45;
 return closed;
}
function parsedChange(raw){
 const text=String(raw??'').trim();
 if(!text||text==='--'||text==='—'||text==='除權息')return null;
 return num(text);
}
function parseDaily(row){
 if(!row||typeof row!=='object')return null;
 const code=String(row.Code??'').trim().toUpperCase();
 const date=isoDate(row.Date);
 const close=positive(row.ClosingPrice);
 if(!/^[0-9]{4,6}[A-Z]?$/.test(code)||!date||!close)return null;
 const change=parsedChange(row.Change);
 const prev=change==null?null:positive(close-change);
 return {code,name:String(row.Name||code).trim(),date,close,
  open:positive(row.OpeningPrice),high:positive(row.HighestPrice),low:positive(row.LowestPrice),
  change,previousClose:prev,volume:num(row.TradeVolume),turnover:num(row.TradeValue),
  trades:num(row.Transaction),source:'TWSE'};
}
function parseIndex(row){
 if(!row||!String(row['指數']??'').includes('發行量加權股價指數')||
     String(row['指數']).includes('報酬'))return null;
 const date=isoDate(row['日期']),close=positive(row['收盤指數']);
 if(!date||!close)return null;
 const magnitude=num(row['漲跌點數']),sign=String(row['漲跌']??'').trim();
 const change=magnitude==null?null:sign==='-'?-Math.abs(magnitude):sign==='+'?Math.abs(magnitude):null;
 return {code:'^TWSE',name:'發行量加權股價指數',date,close,open:null,high:null,low:null,
  change,previousClose:change==null?null:positive(close-change),volume:null,turnover:null,trades:null,source:'TWSE'};
}
function parseDailyList(data){
 const map=new Map();
 for(const row of Array.isArray(data)?data:[]){
  const r=parseDaily(row);if(r)map.set(r.code,r);
 }
 return map;
}
const cache=new Map();
async function getJson(url,{fetcher=root.fetch?.bind(root),signal,ttl=300000}={}){
 const held=cache.get(url);
 if(held&&Date.now()-held.time<ttl)return held.value;
 if(!fetcher)throw new Error('無法使用網路');
 const controller=new AbortController();
 const abort=()=>controller.abort();
 signal?.addEventListener('abort',abort,{once:true});
 const timeout=setTimeout(abort,10000);
 try{
  const response=await fetcher(url,{headers:{Accept:'application/json'},signal:controller.signal});
  if(!response.ok)throw new Error('TWSE HTTP '+response.status);
  const value=await response.json();
  if(!Array.isArray(value))throw new Error('TWSE 資料格式不符合');
  cache.set(url,{time:Date.now(),value});
  return value;
 }finally{
  clearTimeout(timeout);signal?.removeEventListener('abort',abort);
 }
}
async function loadOfficial({fetcher,now=new Date()}={}){
 const params={fetcher};
 const [stock,index,days]=await Promise.allSettled([
  getJson(URLS.daily,params),
  getJson(URLS.index,params),
  getJson(URLS.holidays,{...params,ttl:12*3600000})
 ]);
 const holidays=days.status==='fulfilled'?days.value
  .filter(row=>!/(開始交易|最後交易日)/.test(String(row.Name??'')))
  .map(row=>isoDate(row.Date)).filter(Boolean):[];
 const stocks=stock.status==='fulfilled'?parseDailyList(stock.value):new Map();
 const tai= index.status==='fulfilled'
  ?index.value.map(parseIndex).find(Boolean)||null:null;
 const valid=new Map();
 for(const [code,record] of stocks)if(eligibleDate(record.date,now,holidays))valid.set(code,record);
 if(tai&&eligibleDate(tai.date,now,holidays))valid.set('^TWSE',tai);
 const errors=[stock,index].filter(v=>v.status==='rejected')
  .map(v=>String(v.reason?.message??'無法存取官方資料'));
 return {records:valid,available:valid.size,latestStockDate:stocks.values().next().value?.date??null,
  latestIndexDate:tai?.date??null,errors,holidays};
}
function fundamentalsFromRow(row){
 if(!row)return null;
 return {date:isoDate(row.Date),pe:positive(row.PEratio),
  yieldPct:num(row.DividendYield),pb:positive(row.PBratio)};
}
async function loadFundamentals(code,{fetcher}={}){
 const [ratios,companies,funds]=await Promise.allSettled([
  getJson(URLS.ratios,{fetcher,ttl:3600000}),
  getJson(URLS.companies,{fetcher,ttl:86400000}),
  getJson(URLS.funds,{fetcher,ttl:86400000})
 ]);
 const find=(result,keys)=>result.status==='fulfilled'
  ?result.value.find(row=>keys.some(k=>String(row[k]??'').trim().toUpperCase()===code)):null;
 const ratio=find(ratios,['Code']);
 const company=find(companies,['公司代號','公司統一編號','Code']);
 const fund=find(funds,['基金代號','證券代號','基金證券代號','Code']);
 return {ratios:fundamentalsFromRow(ratio),company:company??null,fund:fund??null};
}
const api={URLS,num,positive,isoDate,taipeiParts,eligibleDate,parseDaily,parseIndex,parseDailyList,
 loadOfficial,loadFundamentals,clearCache:()=>cache.clear()};
if(typeof module==='object'&&module.exports)module.exports=api;
root.SuperETFTWSE=api;
})(globalThis);
