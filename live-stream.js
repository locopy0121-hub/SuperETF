// Fugle Market Data v1.0 — authenticated, event-driven WebSocket subscriptions.
// Pure core with injectable dependencies for deterministic CI tests.
(function(root){
'use strict';
const ENDPOINT='wss://api.fugle.tw/marketdata/v1.0/stock/streaming';
const CHANNELS=new Set(['trades','aggregates','indices']);
const CAPACITY_COOLDOWN_MS=300000; // Official server quota; do not retry every second.
const pos=n=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:null;
function marketTime(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return null;
 const ms=value>1e14?Math.floor(value/1000):value>1e11?value:value*1000;
 return ms>1e12&&ms<5e12?Math.floor(ms):null;
}
function taiwanTradingWindow(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Taipei',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(date);
 const field=kind=>parts.find(x=>x.type===kind)?.value;
 const day=field('weekday');
 const hh=Number(field('hour')),mm=Number(field('minute'));
 return day!=='Sat'&&day!=='Sun'&&Number.isFinite(hh)&&Number.isFinite(mm)&&
   hh*60+mm>=540&&hh*60+mm<810;
}
function parseMarketEvent(packet){
 if(!packet||packet.event!=='data'||!CHANNELS.has(packet.channel))return null;
 const d=packet.data;
 if(!d||typeof d!=='object'||typeof d.symbol!=='string')return null;
 const symbol=d.symbol.trim().toUpperCase();
 if(!/^(?:[0-9]{4,6}[A-Z]?|I[RX][0-9]{4})$/.test(symbol))return null;
 const channel=packet.channel;
 if(channel==='indices'){
  const price=pos(d.index);
  if(!price)return null;
  return {symbol,channel,price,kind:'trade',timestamp:marketTime(d.time),
    previousClose:null,open:null,high:null,low:null};
 }
 if(d.isTrial===true)return null; // Trial is not a completed trade.
 const price=channel==='trades'
   ? pos(d.price)
   : pos(d.lastTrade?.price)??pos(d.closePrice)??pos(d.lastPrice);
 if(!price)return null;
 return {symbol,channel,price,kind:d.isClose===true?'close':'trade',
  timestamp:marketTime(channel==='trades'?d.time:(d.lastUpdated??d.lastTrade?.time??d.closeTime)),
  previousClose:pos(d.previousClose),open:pos(d.openPrice),
  high:pos(d.highPrice),low:pos(d.lowPrice),
  name:typeof d.name==='string'&&d.name.length<=80?d.name:null};
}
function createLiveStream(cfg){
 const WebSocketImpl=cfg.WebSocketImpl||root.WebSocket;
 const clock=cfg.now||(()=>Date.now());
 const setT=cfg.setTimeout||setTimeout,clearT=cfg.clearTimeout||clearTimeout;
 const setI=cfg.setInterval||setInterval,clearI=cfg.clearInterval||clearInterval;
 const enabled=()=>!!cfg.getCredentials()?.enabled&&!!cfg.getCredentials()?.apiKey;
 const marketOpen=cfg.isMarketOpen||(()=>taiwanTradingWindow());
 let socket=null,authenticated=false,desired=false,state='idle',reason='',generation=0,
  reconnectTimer=null,watchdog=null,authTimer=null,subscribeTimer=null,retry=0,lastFrame=0,lastTick=0,subscriptionDenied=false,
  pendingKey=null,attempts=0,lastError='',lastCloseCode=null,
  capacityFailures=0,nextRetryAt=0,lastManualRetryAt=0;
 const sent=new Set(),confirmed=new Set(),failed=new Map(),lastTickBySymbol=new Map();
 function sanitize(value){
  let out=String(value??'').slice(0,220);
  const key=cfg.getCredentials()?.apiKey;
  if(key&&typeof key==='string')out=out.split(key).join('[REDACTED]');
  return out.replace(/(api.?key|token|secret|authorization)\s*[:=]\s*[^,\s;]+/gi,'$1=[REDACTED]').slice(0,140);
 }
 function diagnostics(){return {state,reason,lastFrame,lastTick,subscriptions:confirmed.size,
  authenticated,attempts,lastError,lastCloseCode,pending:pendingKey,nextRetryAt,capacityFailures,
  failed:[...failed].map(([symbol,why])=>({symbol,reason:why})).slice(-12)};}
 const OPEN=1,CONNECTING=0;
 function isOpen(){return socket?.readyState===OPEN;}
 function isLive(){return state==='live'&&authenticated&&confirmed.size>0&&isOpen()&&lastTick>0&&clock()-lastTick<90000;}
 function setStatus(next,detail=''){
  if(state!==next||reason!==detail){
   state=next;reason=detail;
   cfg.onStatus?.(diagnostics());
  }
 }
 function clearTimers(){
  if(reconnectTimer!==null)clearT(reconnectTimer);
  if(authTimer!==null)clearT(authTimer);
  if(subscribeTimer!==null)clearT(subscribeTimer);
  if(watchdog!==null)clearI(watchdog);
  reconnectTimer=authTimer=subscribeTimer=watchdog=null;
 }
 function send(event,data){
  if(!isOpen())return;
  socket.send(JSON.stringify(data?{event,data}:{event}));
 }
 function targets(){
  const list=cfg.getInstruments?.()||[];
  const unique=new Map();
  for(const entry of list){
   const symbol=String(entry.symbol||'').trim().toUpperCase();
   const channel=entry.type==='index'?'indices':null;
   if(!/^(?:[0-9]{4,6}[A-Z]?|I[RX][0-9]{4})$/.test(symbol))continue;
   // One trades stream per stock or ETF; REST provides open/close/high/low baselines.
   const kinds=channel?[channel]:['trades'];
   for(const kind of kinds)unique.set(kind+':'+symbol,{channel:kind,symbol});
  }
  return [...unique.values()];
 }
 function refreshSubscriptions(){
  if(!authenticated||!isOpen()||pendingKey)return;
  const next=targets().find(t=>{
   const key=t.channel+':'+t.symbol;
   return !sent.has(key)&&!failed.has(key);
  });
  if(!next){
   if(!confirmed.size){
    const message=failed.size?'訂閱均未成功，最後錯誤：'+(lastError||'訂閱逾時'):'沒有有效訂閱標的';
    desired=false;clearTimers();cleanupSocket();
    setStatus('subscription-error',message);
   }else if(state!=='live')setStatus('subscribed',
      failed.size?'已訂閱 '+confirmed.size+' 檔，失敗 '+failed.size+' 檔':'已訂閱 '+confirmed.size+' 檔，等待成交');
   return;
  }
  const key=next.channel+':'+next.symbol;
  pendingKey=key;sent.add(key);send('subscribe',next);
  if(state!=='live'&&state!=='subscribed')setStatus('subscribing','逐檔訂閱：'+key);
  if(subscribeTimer!==null)clearT(subscribeTimer);
  subscribeTimer=setT(()=>{
   subscribeTimer=null;
   if(pendingKey!==key)return;
   lastError=key+' 訂閱確認逾時';
   failed.set(key,lastError);pendingKey=null;
   refreshSubscriptions();
  },7000);
 }
 function cleanupSocket(){
  const old=socket;
  socket=null;authenticated=false;pendingKey=null;confirmed.clear();sent.clear();
  if(old){
   old.onopen=old.onclose=old.onerror=old.onmessage=null;
   try{old.close();}catch(error){}
  }
 }
 function capacityWait(){
  if(!desired||!enabled()||!marketOpen()){stop('outside-hours');return;}
  clearTimers();cleanupSocket();
  const delay=Math.min(900000,CAPACITY_COOLDOWN_MS*(2**Math.min(capacityFailures++,2)));
  nextRetryAt=clock()+delay;
  setStatus('capacity-wait','富果 LIVE 連線數已滿；請關閉其他使用同一 API Key 的 App／裝置，釋放名額後再重試');
  reconnectTimer=setT(()=>{
   reconnectTimer=null;
   if(desired&&enabled()&&marketOpen())connect();
  },delay);
 }
 function backoff(reason){
  if(!desired||!enabled()||!marketOpen()){stop('outside-hours');return;}
  cleanupSocket();clearTimers();
  const wait=Math.min(30000,1500*2**Math.min(retry++,5));
  setStatus('reconnecting',reason);
  reconnectTimer=setT(()=>{reconnectTimer=null;connect();},wait);
 }
 function connect(){
  if(!desired||!marketOpen()||!enabled()){stop('outside-hours');return;}
  if(socket&&(socket.readyState===OPEN||socket.readyState===CONNECTING))return;
  if(typeof WebSocketImpl!=='function'){setStatus('unavailable','WebSocket not supported');return;}
  generation++;const g=generation;attempts++;
  authenticated=false;confirmed.clear();sent.clear();failed.clear();pendingKey=null;subscriptionDenied=false;lastTick=0;
  setStatus(retry?'reconnecting':'connecting','建立富果 WebSocket');
  try{socket=new WebSocketImpl(ENDPOINT);}
  catch(e){backoff('socket initialization failed');return;}
  const ws=socket;
  ws.onopen=()=>{
   if(g!==generation||ws!==socket)return;
   lastFrame=clock();
   setStatus('authenticating','等待富果驗證回覆');
   send('auth',{apikey:cfg.getCredentials().apiKey});
   authTimer=setT(()=>{authTimer=null;if(!authenticated)backoff('WebSocket 驗證回覆逾時');},10000);
   watchdog=setI(()=>{
    if(!desired||!marketOpen()){stop('outside-hours');return;}
    // Official heartbeat is every 30 seconds. Allow >2 missed heartbeats.
    if(lastFrame&&clock()-lastFrame>75000)backoff('串流心跳逾時');
    else if(state==='live'&&lastTick&&clock()-lastTick>=90000)setStatus('subscribed','連線正常，等待新成交');
   },10000);
  };
  ws.onmessage=msg=>{
   if(g!==generation||ws!==socket)return;
   lastFrame=clock();
   let packet;
   try{packet=JSON.parse(msg.data);}catch(e){return;}
   if(packet?.event==='authenticated'){
    authenticated=true;retry=0;capacityFailures=0;nextRetryAt=0;
    if(authTimer!==null){clearT(authTimer);authTimer=null;}
    setStatus('subscribing','驗證成功，逐檔確認訂閱');
    refreshSubscriptions();
   }else if(packet?.event==='subscribed'){
    const entries=Array.isArray(packet.data)?packet.data:[packet.data];
    for(const entry of entries){
     const key=entry?.channel+':'+entry?.symbol;
     if(sent.has(key)){
      confirmed.add(key);failed.delete(key);
      if(pendingKey===key){
       pendingKey=null;
       if(subscribeTimer!==null){clearT(subscribeTimer);subscribeTimer=null;}
      }
     }
    }
    if(confirmed.size){
      if(subscribeTimer!==null){clearT(subscribeTimer);subscribeTimer=null;}
      setStatus('subscribed','已訂閱 '+confirmed.size+' 個頻道，等待第一筆即時行情');
    }
    refreshSubscriptions();
   }else if(packet?.event==='data'&&authenticated){
    const update=parseMarketEvent(packet);
    if(!update||!confirmed.has(update.channel+':'+update.symbol))return;
    const last=lastTickBySymbol.get(update.symbol)||0;
    if(update.timestamp&&last&&update.timestamp<last)return;
    if(update.timestamp)lastTickBySymbol.set(update.symbol,update.timestamp);
    lastTick=clock();
    setStatus('live','已接收逐筆即時行情');
    cfg.onQuote?.(update);
   }else if(packet?.event==='error'){
    const raw=String(packet.data?.message??packet.message??'未知錯誤');
    const message=raw.toLowerCase();
    const code=sanitize(packet.data?.code??packet.data?.status??'');
    lastError=(code?'['+code+'] ':'')+sanitize(raw);
    const capacity=/maximum number of connections reached|maximum connections|too many connections|connection (?:quota|limit) (?:reached|exceeded)|concurrent connection limit/i.test(message);
    const invalid=!authenticated&&(/invalid authentication credentials|invalid api.?key|authentication failed|expired api.?key/.test(message)
      ||(code==='401'&&/auth|key|credential/.test(message)));
    if(capacity){
      capacityWait();
    }else if(invalid){
      desired=false;cleanupSocket();clearTimers();
      setStatus('auth-error','富果拒絕 LIVE 金鑰（REST 成功不代表串流授權）');
    }else if(authenticated&&pendingKey){
      // The current subscription is isolated: never discard already-confirmed streams.
      const rejected=pendingKey;pendingKey=null;
      if(subscribeTimer!==null){clearT(subscribeTimer);subscribeTimer=null;}
      failed.set(rejected,lastError);subscriptionDenied=true;
      setStatus(confirmed.size?(isLive()?'live':'subscribed'):'subscribing',
       rejected+' 訂閱失敗：'+lastError);
      refreshSubscriptions();
    }else if(authenticated&&confirmed.size){
      setStatus(isLive()?'live':'subscribed','伺服器回覆：'+lastError);
    }else{
      backoff('WebSocket 伺服器回覆：'+lastError);
    }
   }
  };
  ws.onerror=()=>{if(g===generation&&ws===socket)backoff('WebSocket 傳輸錯誤（瀏覽器未提供原因）');};
  ws.onclose=event=>{
   if(g!==generation||ws!==socket)return;
   lastCloseCode=Number(event?.code)||1006;
   if(/maximum number of connections|too many connections|connection (?:limit|quota)/i.test(String(event?.reason||''))){
     lastError=sanitize(event.reason);capacityWait();return;
   }
   backoff('WebSocket 關閉碼 '+lastCloseCode+(event?.wasClean?'（正常）':'（異常）'));
  };
 }
 function start(){
  desired=true;
  if(!marketOpen()){stop('outside-hours');return;}
  if(!enabled()){stop('disabled');return;}
  if(socket||reconnectTimer!==null||['auth-error','permission-error','subscription-error'].includes(state))return;
  if(nextRetryAt>clock()){
    const wait=Math.max(1,nextRetryAt-clock());
    setStatus('capacity-wait','富果 LIVE 連線名額尚未釋放；等待冷卻後再嘗試');
    reconnectTimer=setT(()=>{reconnectTimer=null;if(desired&&enabled()&&marketOpen())connect();},wait);
    return;
  }
  nextRetryAt=0;connect();
 }
 function stop(reason='outside-hours'){
  generation++;desired=false;cleanupSocket();clearTimers();retry=0;
  setStatus(reason==='disabled'?'disabled':'idle',reason);
 }
 function restart(){
  if(state==='capacity-wait'&&lastManualRetryAt&&clock()-lastManualRetryAt<30000){
    setStatus('capacity-wait','請先釋放其他 App 的串流連線；30 秒內避免重複測試');
    return;
  }
  if(state==='capacity-wait')lastManualRetryAt=clock();
  const hadSocket=!!socket;
  generation++;cleanupSocket();clearTimers();
  retry=0;attempts=0;lastError='';lastCloseCode=null;failed.clear();desired=false;
  nextRetryAt=0;capacityFailures=0;
  setStatus('idle');
  if(hadSocket&&enabled()&&marketOpen()){
    desired=true;setStatus('reconnecting','已釋放舊連線，等待伺服器回收後重建');
    reconnectTimer=setT(()=>{reconnectTimer=null;if(desired&&enabled()&&marketOpen())connect();},2500);
  }else start();
 }
 return {start,stop,restart,refreshSubscriptions,isLive,
  status:diagnostics,
  endpoint:ENDPOINT};
}
const result={ENDPOINT,taiwanTradingWindow,parseMarketEvent,marketTime,createLiveStream};
if(typeof module==='object'&&module.exports)module.exports=result;
root.SuperETFLive=result;
})(globalThis);
