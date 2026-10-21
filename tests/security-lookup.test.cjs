const test=require('node:test');
const assert=require('node:assert/strict');
const fugle=require('../fugle-api.js');
const lookup=require('../security-lookup.js');

test('00406A preserves leading zero and A, auto name is confirmed',async()=>{
  assert.equal(lookup.codeOf(' 00406a '),'00406A');
  assert.equal(lookup.codeOf('TWSE:00406A'),'00406A');
  assert.equal(lookup.isValid('00406A'),true);
  assert.equal(lookup.isValid('../00406A'),false);
  assert.equal(fugle.buildTickerUrl('', '00406A'),
    'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/00406A');
  const found=await lookup.lookupName('00406a');
  assert.equal(found.code,'00406A');
  assert.equal(found.name,'主動中信台灣收益');
});
test('Reject mismatched ticker names and parse valid Fugle response',()=>{
  assert.equal(lookup.fromTicker({symbol:'6777',name:'台積電'},'2330'),null);
  assert.equal(lookup.fromTicker({symbol:'6777',name:'測試名稱'},'6777'),'測試名稱');
  assert.equal(lookup.fromTicker({data:{symbol:'6777',name:'股份公司'}},'6777'),'股份公司');
  assert.equal(lookup.fromTicker({symbol:'6777',name:''},'6777'),null);
});
test('TWSE and TPEx stock lists use different code/name fields',()=>{
  const [twse,tpex]=lookup.markets;
  assert.equal(lookup.parseMarket([{Code:'6731',Name:'上市公司'}],twse).get('6731'),'上市公司');
  assert.equal(lookup.parseMarket([{SecuritiesCompanyCode:'6732',CompanyName:'上櫃公司'}],tpex).get('6732'),'上櫃公司');
});
test('Fugle ticker takes priority and always uses protected official host',async()=>{
  let requests=0;
  const fetcher=async(url,options)=>{
    requests++;
    assert.equal(url,'https://api.fugle.tw/marketdata/v1.0/stock/intraday/ticker/6998');
    assert.equal(options.headers['X-API-KEY'],'dummy-key');
    return {ok:true,json:async()=>({symbol:'6998',name:'測試 ETF'})};
  };
  const found=await lookup.lookupName('6998',{apiKey:'dummy-key',fetcher});
  assert.equal(found.name,'測試 ETF');assert.equal(found.source,'富果');
  assert.equal(requests,1);
});
test('Remote TWSE fallback when Fugle is disabled',async()=>{
  let count=0;
  const fetcher=async(url)=>{
    count++;
    assert.ok(url.includes('openapi.twse.com.tw'));
    return {ok:true,json:async()=>[{Code:'6718',Name:'上市新股票'}]};
  };
  const found=await lookup.lookupName('6718',{fetcher});
  assert.equal(found.name,'上市新股票');
  assert.equal(found.source,'證交所');assert.equal(count,1);
});
test('Input debounce, hand edit, and stale response protection',async()=>{
  function element(){
    return {value:'',textContent:'',className:'',listeners:{},
      addEventListener(event,fn){this.listeners[event]=fn;},
      fire(event){this.listeners[event]?.();}};
  }
  const code=element(),name=element(),status=element();
  const bind=lookup.bindCodeName({codeInput:code,nameInput:name,statusElement:status,delay:1});
  code.value='00406A';code.fire('input');
  await new Promise(resolve=>setTimeout(resolve,18));
  assert.equal(name.value,'主動中信台灣收益');
  code.value='0050';code.fire('input');
  await new Promise(resolve=>setTimeout(resolve,18));
  assert.equal(name.value,'元大台灣50');
  name.value='手動修正';name.fire('input');
  code.value='00406A';code.fire('input');
  await new Promise(resolve=>setTimeout(resolve,18));
  assert.equal(name.value,'手動修正');
  bind.reset();
  name.value='';code.value='00406A';
  await bind.resolveNow();
  assert.equal(name.value,'主動中信台灣收益');
  assert.ok(status.textContent.includes('已填入'));
});
test('Old request must not overwrite changed code',async()=>{
  function element(){return {value:'',textContent:'',className:'',events:{},
    addEventListener(n,fn){this.events[n]=fn;},fire(n){this.events[n]?.();}};}
  const code=element(),name=element(),status=element();
  let finish;
  const fetcher=()=>new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({symbol:'6871',name:'舊回應'})});});
  const bind=lookup.bindCodeName({codeInput:code,nameInput:name,statusElement:status,
    delay:1,options:()=>({apiKey:'k',fetcher})});
  code.value='6871';code.fire('input');
  await new Promise(r=>setTimeout(r,12));
  code.value='00406A';code.fire('input');
  await new Promise(r=>setTimeout(r,18));
  finish();
  await new Promise(r=>setTimeout(r,12));
  assert.equal(name.value,'主動中信台灣收益');
  bind.reset();
});
