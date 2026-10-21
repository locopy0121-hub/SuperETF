const test=require('node:test'),assert=require('node:assert/strict');
const twse=require('../twse-close.js');
const EOD='2026-10-21T08:26:00Z'; // Taipei 16:26

test('ROC date parsing and TWSE stock OHLCV including active ETF alphanumeric code',()=>{
 assert.equal(twse.isoDate('1151021'),'2026-10-21');
 assert.equal(twse.isoDate('115/10/21'),'2026-10-21');
 assert.equal(twse.isoDate('invalid'),null);
 const row=twse.parseDaily({Date:'1151021',Code:'00415A',Name:'主動群益核心50',
  TradeVolume:'1,234,567',TradeValue:'12,345,678',Transaction:'888',
  OpeningPrice:'9.10',HighestPrice:'9.26',LowestPrice:'9.05',ClosingPrice:'9.22',Change:'+0.13'});
 assert.equal(row.code,'00415A');assert.equal(row.close,9.22);
 assert.equal(row.previousClose,9.09);assert.equal(row.high,9.26);
 assert.equal(row.volume,1234567);assert.equal(row.turnover,12345678);assert.equal(row.trades,888);
});

test('Reject invalid/no official closing price and never convert reference/trial into close',()=>{
 assert.equal(twse.parseDaily({Date:'1151021',Code:'2330',ClosingPrice:'--'}),null);
 assert.equal(twse.parseDaily({Date:'1151021',Code:'2330',ClosingPrice:'0'}),null);
 assert.equal(twse.parseDaily({Date:'1151021',Code:'2330',ClosingPrice:'2,420'}).close,2420);
 assert.equal(twse.parseDaily({Date:'1151021',Code:'2330',ClosingPrice:'100',Change:'--'}).previousClose,null);
});

test('TAIEX official EOD uses price index and correctly signed percentage base',()=>{
 const r=twse.parseIndex({'日期':'1151021','指數':'發行量加權股價指數',
  '收盤指數':'47,001.25','漲跌':'-','漲跌點數':'109.33','漲跌百分比':'-0.23'});
 assert.equal(r.close,47001.25);assert.equal(r.change,-109.33);
 assert.equal(r.previousClose,47110.58);
 assert.equal(twse.parseIndex({'日期':'1151021','指數':'發行量加權股價報酬指數','收盤指數':'2'}),null);
});

test('On trading Wednesday stale Tuesday TWSE cannot overwrite todays REST price',()=>{
 const now=new Date(EOD);
 assert.equal(twse.eligibleDate('2026-10-20',now,[]),false);
 assert.equal(twse.eligibleDate('2026-10-21',now,[]),true);
 assert.equal(twse.eligibleDate('2026-10-22',now,[]),false);
 assert.equal(twse.eligibleDate('2026-10-21',new Date('2026-10-21T04:01:00Z'),[]),false);
 assert.equal(twse.eligibleDate('2026-10-20',new Date('2026-10-24T04:01:00Z'),[]),false);
 assert.equal(twse.eligibleDate('2026-10-23',new Date('2026-10-24T04:01:00Z'),[]),true);
 assert.equal(twse.eligibleDate('2026-10-20',now,['2026-10-21']),true);
});

test('Official snapshot accepts only correct session; partial stale index not merged',async()=>{
 twse.clearCache();
 const fetcher=async url=>{
   if(url===twse.URLS.daily)return {ok:true,json:async()=>[
     {Date:'1151020',Code:'2330',Name:'台積電',ClosingPrice:'2400',Change:'+10'},
     {Date:'1151021',Code:'00415A',Name:'主動群益核心50',ClosingPrice:'9.22',Change:'+0.13'}]};
   if(url===twse.URLS.index)return {ok:true,json:async()=>[
     {'日期':'1151020','指數':'發行量加權股價指數','收盤指數':'46,292.93','漲跌':'-','漲跌點數':'529.15'}]};
   if(url===twse.URLS.holidays)return {ok:true,json:async()=>[]};
   throw Error('unknown URL');
 };
 const out=await twse.loadOfficial({fetcher,now:new Date(EOD)});
 assert.equal(out.records.has('2330'),false);
 assert.equal(out.records.get('00415A').close,9.22);
 assert.equal(out.records.has('^TWSE'),false);
 assert.equal(out.latestIndexDate,'2026-10-20');
});

test('Official BWIBBU ratios are numeric, blanks are unavailable',async()=>{
 twse.clearCache();
 const fetcher=async url=>{
  if(url===twse.URLS.ratios)return {ok:true,json:async()=>[{Date:'1151021',Code:'2330',PEratio:'21.5',DividendYield:'2.23',PBratio:'7.18'}]};
  return {ok:true,json:async()=>[]};
 };
 const result=await twse.loadFundamentals('2330',{fetcher});
 assert.deepEqual(result.ratios,{date:'2026-10-21',pe:21.5,yieldPct:2.23,pb:7.18});
 assert.equal(result.company,null);
});

test('After midnight and before session open, use latest completed TWSE close',()=>{
 const midnight=new Date('2026-10-21T16:45:00Z'); // 2026-10-22 00:45 Taiwan
 assert.equal(twse.lastCompletedTradingDate(midnight),'2026-10-21');
 assert.equal(twse.eligibleDate('2026-10-21',midnight),true);
 assert.equal(twse.eligibleDate('2026-10-20',midnight),false);
 const morning=new Date('2026-10-22T00:45:00Z'); // 08:45 Taiwan
 assert.equal(twse.eligibleDate('2026-10-21',morning),true);
 const nextClose=new Date('2026-10-22T06:10:00Z'); // 14:10 Taiwan
 assert.equal(twse.eligibleDate('2026-10-21',nextClose),false);
 assert.equal(twse.eligibleDate('2026-10-22',nextClose),true);
});
test('00406A official active ETF close is recognized with ticker suffix',()=>{
 const q=twse.parseDaily({Date:'1151021',Code:'00406A',Name:'主動中信台灣收益',
  ClosingPrice:'9.32',OpeningPrice:'9.30',HighestPrice:'9.42',LowestPrice:'9.28',Change:'+0.02'});
 assert.equal(q.code,'00406A');
 assert.equal(q.name,'主動中信台灣收益');
 assert.equal(q.close,9.32);
 assert.equal(twse.eligibleDate(q.date,new Date('2026-10-21T16:45:00Z')),true);
});
