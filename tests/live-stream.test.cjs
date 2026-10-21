const test=require('node:test');
const assert=require('node:assert/strict');
const live=require('../live-stream.js');

class FakeSocket {
 static instances=[];
 constructor(endpoint){
  this.endpoint=endpoint;this.readyState=0;this.sent=[];
  FakeSocket.instances.push(this);
 }
 send(msg){this.sent.push(JSON.parse(msg));}
 open(){this.readyState=1;this.onopen?.();}
 emit(data){this.onmessage?.({data:JSON.stringify(data)});}
 close(){this.readyState=3;this.onclose?.();}
}
function fakeClock(){
 const timers=new Map(),intervals=new Map();let counter=1,now=1761010200000;
 return {clock:()=>now,advance(ms){now+=ms;},timers,intervals,
  setTimeout(fn,ms){const id=counter++;timers.set(id,{fn,ms});return id;},
  clearTimeout(id){timers.delete(id);},
  setInterval(fn,ms){const id=counter++;intervals.set(id,{fn,ms});return id;},
  clearInterval(id){intervals.delete(id);},
  triggerTimeouts(){const tasks=[...timers.values()];timers.clear();for(const t of tasks)t.fn();}
 };
}
function create(cfg={}){
 const clock=fakeClock(),updates=[],states=[];
 const engine=live.createLiveStream({
  WebSocketImpl:FakeSocket,...clock,
  getCredentials:()=>({enabled:true,apiKey:'secret'}),
  isMarketOpen:()=>true,
  getInstruments:()=>[{symbol:'2330',type:'stock'},{symbol:'IX0001',type:'index'}],
  onQuote:quote=>updates.push(quote),onStatus:s=>states.push(s),
  ...cfg
 });
 return {clock,engine,updates,states};
}
test('Taiwan 09:00–13:30 weekday only; cannot infer holidays',()=>{
 assert.equal(live.taiwanTradingWindow(new Date('2026-10-21T01:00:00.000Z')),true);
 assert.equal(live.taiwanTradingWindow(new Date('2026-10-21T05:29:00.000Z')),true);
 assert.equal(live.taiwanTradingWindow(new Date('2026-10-21T05:30:00.000Z')),false);
 assert.equal(live.taiwanTradingWindow(new Date('2026-10-18T02:00:00.000Z')),false);
});
test('trades and aggregates reject trial prices, indices uses index field',()=>{
 assert.equal(live.parseMarketEvent({event:'data',channel:'trades',data:{symbol:'2330',price:880,isTrial:true}}),null);
 assert.equal(live.parseMarketEvent({event:'data',channel:'aggregates',data:{symbol:'2330',isTrial:true,lastPrice:900}}),null);
 assert.equal(live.parseMarketEvent({event:'data',channel:'indices',data:{symbol:'IX0001',index:25000}}).price,25000);
 assert.equal(live.parseMarketEvent({event:'data',channel:'indices',data:{symbol:'IX0001',index:0}}),null);
 assert.equal(live.parseMarketEvent({event:'data',channel:'trades',data:{symbol:'2330',price:100, time:1685338200000000}}).timestamp,1685338200000);
 assert.equal(live.parseMarketEvent({event:'data',channel:'aggregates',data:{symbol:'2330',lastPrice:880,previousClose:850,openPrice:860,highPrice:885,lowPrice:820}}).previousClose,850);
});
test('WebSocket authenticates before subscribing and LIVE only after confirmed subscriptions',()=>{
 FakeSocket.instances=[];
 const {engine,updates}=create();
 engine.start();engine.start();
 assert.equal(FakeSocket.instances.length,1);
 const ws=FakeSocket.instances[0];
 assert.equal(ws.endpoint,live.ENDPOINT);
 assert.equal(engine.isLive(),false);
 ws.open();
 assert.deepEqual(ws.sent[0],{event:'auth',data:{apikey:'secret'}});
 assert.equal(ws.sent.filter(v=>v.event==='subscribe').length,0);
 ws.emit({event:'authenticated',data:{}});
 assert.deepEqual(ws.sent.filter(v=>v.event==='subscribe').map(v=>v.data.channel).sort(),['aggregates','indices','trades']);
 assert.equal(engine.isLive(),false);
 ws.emit({event:'subscribed',data:[{symbol:'2330',channel:'trades',id:'t'},{symbol:'2330',channel:'aggregates',id:'a'}]});
 assert.equal(engine.isLive(),true);
 ws.emit({event:'data',channel:'trades',data:{symbol:'2330',price:940,time:1685338200000000}});
 assert.equal(updates[0].price,940);
 ws.emit({event:'data',channel:'indices',data:{symbol:'IX0001',index:46500,time:1685338200000000}});
 assert.equal(updates[1].price,46500);
 ws.emit({event:'data',channel:'trades',data:{symbol:'2330',price:930,time:1685338100000000}});
 assert.equal(updates.length,2,'older ticks must not regress live price');
 engine.stop();
 assert.equal(engine.isLive(),false);
});
test('New holding auto-subscribes on current authenticated WebSocket',()=>{
 FakeSocket.instances=[];
 let instruments=[{symbol:'0050',type:'etf'}];
 const {engine}=create({getInstruments:()=>instruments});
 engine.start();const ws=FakeSocket.instances[0];ws.open();ws.emit({event:'authenticated'});
 assert.equal(ws.sent.filter(x=>x.event==='subscribe').length,2);
 instruments.push({symbol:'00406A',type:'etf'});
 engine.refreshSubscriptions();
 assert.equal(ws.sent.filter(x=>x.event==='subscribe').length,4);
 engine.refreshSubscriptions();
 assert.equal(ws.sent.filter(x=>x.event==='subscribe').length,4);
 engine.stop();
});
test('Socket disconnect uses exponential reconnect and does not label REST as LIVE',()=>{
 FakeSocket.instances=[];
 const {engine,clock}=create();
 engine.start();const first=FakeSocket.instances[0];first.open();
 first.emit({event:'authenticated'});
 first.emit({event:'subscribed',data:{symbol:'2330',channel:'trades',id:'q'}});
 assert.equal(engine.isLive(),true);
 first.close();
 assert.equal(engine.isLive(),false);
 assert.equal(engine.status().state,'reconnecting');
 assert.equal([...clock.timers.values()][0].ms,1500);
 clock.triggerTimeouts();
 assert.equal(FakeSocket.instances.length,2);
 engine.stop();
});
test('No key, offline market, auth failure do not claim LIVE',()=>{
 FakeSocket.instances=[];
 const noKey=create({getCredentials:()=>({enabled:true,apiKey:''})});
 noKey.engine.start();assert.equal(noKey.engine.isLive(),false);assert.equal(FakeSocket.instances.length,0);
 const weekend=create({isMarketOpen:()=>false});
 weekend.engine.start();assert.equal(FakeSocket.instances.length,0);
 const invalid=create();
 invalid.engine.start();const ws=FakeSocket.instances.at(-1);ws.open();
 ws.emit({event:'error',data:{message:'Invalid authentication credentials'}});
 assert.equal(invalid.engine.status().state,'auth-error');assert.equal(invalid.engine.isLive(),false);
 invalid.engine.stop();
});
test('Missed heartbeat forces reconnect, stop clears all timers',()=>{
 FakeSocket.instances=[];
 const {engine,clock}=create();
 engine.start();const ws=FakeSocket.instances[0];ws.open();
 ws.emit({event:'authenticated'});
 const timers=[...clock.intervals.values()];assert.equal(timers.length,1);
 clock.advance(76000);timers[0].fn();
 assert.equal(engine.status().state,'reconnecting');
 engine.stop();assert.equal(clock.timers.size,0);assert.equal(clock.intervals.size,0);
});
