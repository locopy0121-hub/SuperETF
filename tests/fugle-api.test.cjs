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
test('辨識官方 quote 欄位與不完整行情', () => {
  assert.deepEqual(api.parseQuote({lastPrice:1060,openPrice:1050,highPrice:1065,lowPrice:1042}),
    {price:1060,open:1050,high:1065,low:1042});
  assert.equal(api.parseQuote({lastPrice:null}), null);
  assert.equal(api.parseQuote({lastPrice:'NaN'}), null);
});
test('404、401、429 不混為同一錯誤', () => {
  assert.match(api.httpError(404,'0050'), /路由或代號/);
  assert.match(api.httpError(401,'0050'), /API Key/);
  assert.match(api.httpError(429,'0050'), /速率限制/);
});
