// SuperETF stock / ETF symbol lookup: Fugle ticker, TWSE, TPEx.
(function(root){
'use strict';
const api=root.SuperETFFugleAPI;
const verified=Object.freeze({
 '00406A':'主動中信台灣收益','0050':'元大台灣50','0056':'元大高股息',
 '2303':'聯電','2330':'台積電','2884':'玉山金','6605':'帝寶'
});
const markets=[
 {id:'twse',label:'證交所',url:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  keys:['Code','證券代號'],names:['Name','證券名稱']},
 {id:'tpex',label:'櫃買中心',url:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
  keys:['SecuritiesCompanyCode','Code'],names:['CompanyName','Name']}
];
const cache=new Map(),marketCache=new Map();
function codeOf(raw){return String(raw??'').trim().toUpperCase().replace(/^(TWSE|TPEX|TSE|OTC):/,'').replace(/\.(TW|TWO)$/,'');}
function isValid(raw){return /^[0-9]{4,6}[A-Z]?$/.test(codeOf(raw));}
function cleanName(raw){const s=typeof raw==='string'?raw.trim():'';return s&&s.length<=80&&!/^(--?|N\/A|null|undefined)$/i.test(s)?s:null;}
function fromTicker(data,expected){
 const row=data?.data&&!Array.isArray(data.data)?data.data:data;
 return row&&codeOf(row.symbol??row.code)===expected?cleanName(row.name??row.Name):null;
}
function parseMarket(data,market){
 const found=new Map();
 if(!Array.isArray(data))return found;
 for(const item of data){
  const code=codeOf(market.keys.map(k=>item?.[k]).find(v=>v!=null&&String(v).trim())??'');
  const name=cleanName(market.names.map(k=>item?.[k]).find(v=>v!=null&&String(v).trim()));
  if(isValid(code)&&name)found.set(code,name);
 }
 return found;
}
async function readJson(url,headers,fetcher,signal){
 if(signal?.aborted)throw new Error('cancelled');
 const controller=new AbortController();
 const stop=()=>controller.abort();
 signal?.addEventListener('abort',stop,{once:true});
 const timer=setTimeout(stop,7000);
 try{
  const response=await fetcher(url,{headers,signal:controller.signal});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return await response.json();
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}
async function lookupName(raw,opts={}){
 const code=codeOf(raw);
 if(!isValid(code))return null;
 if(verified[code])return {code,name:verified[code],source:'已核對證券清單'};
 if(cache.has(code))return cache.get(code);
 const fetcher=opts.fetcher??root.fetch?.bind(root);
 if(!fetcher)return null;
 if(opts.apiKey&&api){
  try{
   const url=api.buildTickerUrl(opts.baseUrl,code);
   const data=await readJson(url,{'X-API-KEY':opts.apiKey,Accept:'application/json'},fetcher,opts.signal);
   const name=fromTicker(data,code);
   if(name){const result={code,name,source:'富果'};cache.set(code,result);return result;}
  }catch(error){if(opts.signal?.aborted)return null;}
 }
 for(const market of markets){
  if(opts.signal?.aborted)return null;
  try{
   let names=marketCache.get(market.id);
   if(!names||Date.now()-names.at>86400000){
    const records=await readJson(market.url,{Accept:'application/json'},fetcher,opts.signal);
    const values=parseMarket(records,market);
    if(!values.size)continue;
    names={at:Date.now(),values};marketCache.set(market.id,names);
   }
   const name=names.values.get(code);
   if(name){const result={code,name,source:market.label};cache.set(code,result);return result;}
  }catch(error){if(opts.signal?.aborted)return null;}
 }
 return null;
}
function bindCodeName({codeInput,nameInput,statusElement,options=()=>({}),delay=320}){
 let sequence=0,timer=null,active=null,autoName='';
 function state(message,kind=''){
  statusElement.textContent=message;
  statusElement.className='symbol-lookup-status'+(kind?' '+kind:'');
 }
 function stop(){
  if(timer!==null)clearTimeout(timer);
  timer=null;if(active)active.abort();active=null;
 }
 async function run(code,id){
  const ctrl=new AbortController();active=ctrl;
  let hit=null;
  try{hit=await lookupName(code,{...options(),signal:ctrl.signal});}catch(error){}
  if(id!==sequence||codeOf(codeInput.value)!==code)return null;
  active=null;
  if(!hit){state('查無資料或來源無法連線，請手動填入名稱','warn');return null;}
  if(!nameInput.value.trim()){
   nameInput.value=hit.name;autoName=hit.name;
   state('已填入：'+hit.name+'（'+hit.source+'）','ok');
  }else state('查得：'+hit.name+'；保留手動輸入名稱','warn');
  return hit;
 }
 function changed(){
  sequence++;stop();
  if(autoName&&nameInput.value.trim()===autoName)nameInput.value='';
  autoName='';
  const code=codeOf(codeInput.value);
  if(!code){state('輸入代號後自動帶入名稱');return;}
  if(!isValid(code)){state(code.length<4?'請繼續輸入代號':'代號格式不正確','warn');return;}
  state('查詢 '+code+' 中…');
  const id=sequence;
  timer=setTimeout(()=>{timer=null;void run(code,id);},delay);
 }
 codeInput.addEventListener('input',changed);
 nameInput.addEventListener('input',()=>{autoName='';if(nameInput.value.trim())state('保留手動輸入名稱');});
 async function resolveNow(){
  sequence++;stop();
  const code=codeOf(codeInput.value);
  if(!isValid(code))return null;
  state('查詢 '+code+' 中…');
  return run(code,sequence);
 }
 function reset(){sequence++;stop();autoName='';state('輸入代號後自動帶入名稱');}
 reset();
 return {resolveNow,reset};
}
const result={codeOf,isValid,fromTicker,parseMarket,lookupName,bindCodeName,markets};
if(typeof module==='object'&&module.exports)module.exports=result;
root.SuperETFSecurityLookup=result;
})(globalThis);
