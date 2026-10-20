const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../fugle-api.js');
test('標準 v1.0 路由及舊版 URL 自動轉換', () => {
  for (const base of ['', api.REST_BASE, api.REST_BASE + '/',
    api.REST_BASE + '/stock/intraday/quote/',
    api.REST_BASE + '/stock/intraday/quote/0050',
    'https://api.fuguo.tw/v1/quote/']) {
    assert.equal(api.buildQuoteUrl(base, '2330'),
      'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330');
  }
});
test('遷移舊版股票與加權指數代號', () => {
  assert.equal(api.normalizeSymbol('TWSE:0050'), '0050');
  assert.equal(api.normalizeSymbol('2330.TW'), '2330');
  assert.equal(api.normalizeSymbol('^TWSE'), 'IR0001');
  assert.equal(api.normalizeSymbol('TWSE'), 'IR0001');
  assert.equal(api.buildQuoteUrl('', '^TWSE').endsWith('/IR0001'), true);
});
test('不允許 API Key 送往不安全主機', () => {
  for (const url of ['http://api.fugle.tw/marketdata/v1.0',
    'https://api.fugle.tw.evil.com/marketdata/v1.0',
    'https://api.fugle.tw/marketdata/v1.0?key=secret',
    'https://api.fugle.tw/marketdata/v2.0']) {
    assert.throws(() => api.buildQuoteUrl(url, '0050'));
  }
  assert.throws(() => api.normalizeSymbol('../2330'));
});
test('官方行情正常成交時保留成交種類與昨收', () => {
  assert.deepEqual(api.parseQuote({lastPrice:1060,openPrice:1050,highPrice:1065,lowPrice:1042,previousClose:1030}),
    {price:1060,open:1050,high:1065,low:1042,previousClose:1030,kind:'trade'});
});
test('08:03 盤前 HTTP 200：參考價是價格，不是成交價', () => {
  const q = api.parseQuote({symbol:'0050',lastPrice:null,closePrice:null,referencePrice:62.4,previousClose:62.4});
  assert.equal(q.price,62.4);
  assert.equal(q.kind,'reference');
  assert.match(api.quoteStatus(q),/盤前參考價/);
});
test('僅有昨收價時與試撮價時都可解析，並分辨狀態', () => {
  const q = api.parseQuote({previousClose:61.8});
  assert.equal(q.kind,'previous');
  assert.match(api.quoteStatus(q),/昨收價/);
  const trial = api.parseQuote({lastPrice:63.05,isTrial:true,referencePrice:62.4});
  assert.equal(trial.kind,'trial');
  assert.match(api.quoteStatus(trial),/試撮/);
  assert.equal(api.parseQuote({lastTrial:{price:63.15},isTrial:true}).kind,'trial');
});
test('HTTP 200 的空報價不再等於認證失敗', () => {
  assert.equal(api.parseQuote({lastPrice:null}),null);
  assert.equal(api.parseQuote({lastPrice:'NaN'}),null);
  assert.equal(api.parseQuote({}),null);
  assert.match(api.quoteStatus(null),/已連線/);
});
test('404、401、429 不混為同一錯誤', () => {
  assert.match(api.httpError(404,'0050'), /路由或代號/);
  assert.match(api.httpError(401,'0050'), /API Key/);
  assert.match(api.httpError(429,'0050'), /速率限制/);
});
