// Fugle Market Data v1.0 — authenticated, event-driven WebSocket subscriptions.
// Pure core with injectable dependencies for deterministic CI tests.
(function(root){
'use strict';
const ENDPOINT='wss://api.fugle.tw/marketdata/v1.0/stock/streaming';
const CHANNELS=new Set(['trades','aggregates','indices']);
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
  reconnectTimer=null,watchdog=null,authTimer=null,subscribeTimer=null,retry=0,lastFrame=0,lastTick=0,subscriptionDenied=false;
 const sent=new Set(),confirmed=new Set(),lastTickBySymbol=new Map();
 const OPEN=1,CONNECTING=0;
 function isOpen(){return socket?.readyState===OPEN;}
 function isLive(){return state==='live'&&authenticated&&confirmed.size>0&&isOpen()&&lastTick>0&&clock()-lastTick<90000;}
 function setStatus(next,detail=''){
  if(state!==next||reason!==detail){
   state=next;reason=detail;
   cfg.onStatus?.({state,reason,lastFrame,lastTick,subscriptions:confirmed.size});
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
  if(!authenticated||!isOpen())return;
  for(const t of targets()){
   const key=t.channel+':'+t.symbol;
   if(sent.has(key))continue;
   sent.add(key);send('subscribe',t);
  }
 }
 function cleanupSocket(){
  const old=socket;
  socket=null;authenticated=false;confirmed.clear();sent.clear();
  if(old){
   old.onopen=old.onclose=old.onerror=old.onmessage=null;
   try{old.close();}catch(error){}
  }
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
  generation++;const g=generation;
  authenticated=false;confirmed.clear();sent.clear();subscriptionDenied=false;lastTick=0;
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
    authenticated=true;retry=0;
    if(authTimer!==null){clearT(authTimer);authTimer=null;}
    setStatus('subscribing','已驗證，等待訂閱確認');
    refreshSubscriptions();
    if(subscribeTimer!==null)clearT(subscribeTimer);
    subscribeTimer=setT(()=>{
      subscribeTimer=null;
      if(confirmed.size)return;
      if(subscriptionDenied){
        desired=false;cleanupSocket();clearTimers();
        setStatus('permission-error','富果未授權申請的即時行情頻道');
      }else backoff('訂閱確認逾時');
    },12000);
   }else if(packet?.event==='subscribed'){
    const entries=Array.isArray(packet.data)?packet.data:[packet.data];
    for(const entry of entries){
     const key=entry?.channel+':'+entry?.symbol;
     if(sent.has(key))confirmed.add(key);
    }
    if(confirmed.size){
      if(subscribeTimer!==null){clearT(subscribeTimer);subscribeTimer=null;}
      setStatus('subscribed','已訂閱 '+confirmed.size+' 個頻道，等待第一筆即時行情');
    }
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
    // Only an explicit credential rejection is a terminal authentication error.
    // Fugle also emits errors for network, rate limits and individual subscriptions.
    const message=String(packet.data?.message||'').toLowerCase();
    const code=String(packet.data?.code??packet.data?.status??'');
    const invalid=!authenticated&&(/invalid authentication credentials|invalid api.?key|authentication failed|expired api.?key/.test(message)
      ||(code==='401'&&/auth|key|credential/.test(message)));
    const permission=/permission|not allowed|not authorized|unauthorized|subscription|channel/.test(message);
    if(invalid){
      desired=false;cleanupSocket();clearTimers();
      setStatus('auth-error','富果拒絕 WebSocket 金鑰，需核對串流服務授權');
    }else if(permission&&authenticated){
      subscriptionDenied=true;
      if(confirmed.size)setStatus(isLive()?'live':'subscribed','部分頻道權限不足，其餘繼續更新');
      else setStatus('subscribing','部分頻道遭拒，等待其他訂閱確認');
    }else if(code==='429'||/rate.limit|too many/.test(message)){
      backoff('WebSocket 頻率限制');
    }else{
      backoff('WebSocket 網路或伺服器錯誤，正在重試');
    }
   }
  };
  ws.onerror=()=>{if(g===generation&&ws===socket)backoff('network error');};
  ws.onclose=()=>{if(g===generation&&ws===socket)backoff('connection closed');};
 }
 function start(){
  desired=true;
  if(!marketOpen()){stop('outside-hours');return;}
  if(!enabled()){stop('disabled');return;}
  if(socket||reconnectTimer!==null||state==='auth-error'||state==='permission-error')return;
  connect();
 }
 function stop(reason='outside-hours'){
  generation++;desired=false;cleanupSocket();clearTimers();retry=0;
  setStatus(reason==='disabled'?'disabled':'idle',reason);
 }
 function restart(){
  generation++;cleanupSocket();clearTimers();retry=0;desired=false;
  setStatus('idle');
  start();
 }
 return {start,stop,restart,refreshSubscriptions,isLive,
  status:()=>({state,reason,lastFrame,lastTick,subscriptions:confirmed.size,authenticated}),
  endpoint:ENDPOINT};
}
const result={ENDPOINT,taiwanTradingWindow,parseMarketEvent,marketTime,createLiveStream};
if(typeof module==='object'&&module.exports)module.exports=result;
root.SuperETFLive=result;
})(globalThis);
