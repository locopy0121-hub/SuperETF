const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');
const html=fs.readFileSync('index.html','utf8');

test('Taiwan price gain must be red, loss green, unchanged yellow',()=>{
 assert.match(css,/\.up\{color:var\(--red\)\}/);
 assert.match(css,/\.down\{color:var\(--green\)\}/);
 assert.match(css,/\.flat\{color:var\(--yellow\)\}/);
 assert.match(css,/--yellow:#facc15/);
 assert.match(css,/\.unknown\{color:var\(--muted\)\}/);
 assert.ok(app.includes("up:'#ef4444',down:'#22c55e',flat:'#facc15'"));
});
test('PnL class does not mark unknown quote as unchanged yellow',()=>{
 const mark=app.match(/function cls\(p\) \{[\s\S]*?\n\}/);
 assert.ok(mark,'cls helper missing');
 const cls=Function(mark[0]+';return cls;')();
 assert.equal(cls(0),'flat');
 assert.equal(cls(0.00001),'up');
 assert.equal(cls(-0.00001),'down');
 assert.equal(cls(null),'unknown');
 assert.equal(cls(undefined),'unknown');
 assert.equal(cls(NaN),'unknown');
});
test('Stock chart and portfolio use unified Taiwan gain/loss color helpers',()=>{
 assert.ok(app.includes("ctx.strokeStyle=pnlStroke("));
 assert.ok(app.includes("class=\\"price \${cls(q.hasReal?p:null)}\\""));
 assert.ok(app.includes("class=\\"chg \${cls(q.hasReal?p:null)}\\""));
 assert.ok(app.includes("class=\\"\${cls(q?.hasReal?q.pctChg:null)}\\""));
 assert.match(css,/\.security-price\.up\{color:var\(--red\)\}/);
});
test('Save triggers all dependent panels and targeted quote lookup after close',()=>{
 assert.ok(html.includes('id="holding-sync-status"'));
 assert.ok(app.includes('holdings.push(item)'));
 assert.ok(app.includes('save(LS.holdings,holdings)'));
 assert.ok(app.includes('void refreshNewHoldingQuote(code)'));
 assert.ok(app.includes('refreshAllHoldingViews();'));
 assert.match(app,/async function refreshNewHoldingQuote\(code\)/);
 assert.ok(app.includes('if(!isMarketOpen())await refreshOfficialClose(true)'));
 assert.ok(app.includes('await MarketData.fetchFuguo([q])'));
 assert.ok(app.includes('await MarketData.fetchYahoo([q])'));
 assert.ok(app.includes('renderLive();renderPnl();renderPortfolio();renderDividends()'));
 assert.ok(app.includes("if(isMarketOpen())return; // Night/early morning"));
});
test('00406A dynamic quote is classified as ETF and can receive EOD',()=>{
 assert.ok(app.includes("const type=/^00[0-9]{2,4}[A-Z]?$/.test(code)"));
 assert.ok(app.includes('ensureHoldingQuote(item)'));
 assert.ok(app.includes("type, base:0, drift:0, yahoo:code+'.TW'"));
});
