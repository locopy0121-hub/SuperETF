const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
test('六頁 DOM 契約',()=>{
 for(const id of ['live-grid','pnl-summary','pnl-wall','portfolio-body','transactions',
 'dividend-summary','dividend-list','analysis-canvas','cfg-feedback']){
 assert.ok(html.includes('id="'+id+'"'));assert.ok(app.includes(id));}
 for(const id of ['btn-add-holding','fh-save','fh-cancel','btn-add-dividend','fd-save','fd-cancel','cfg-save','cfg-test'])
 assert.ok(app.includes("getElementById('"+id+"').addEventListener"),'Missing '+id);
});
test('可執行的 JS 入口與禁用虛構損益',()=>{
 assert.ok(html.includes('<script src="fugle-api.js"></script>'));
 assert.ok(html.includes('<script src="app.js"></script>'));
 assert.ok(app.includes('marketLoop();'));
 assert.ok(app.includes('q?.hasReal'));
 assert.ok(app.includes('Prices are fetched, never random-walked'));
});
test('App 版本一致',()=>{
 const v=require('../package.json').version;
 assert.ok(html.includes('v'+v));assert.ok(app.includes("const VERSION = '"+v+"'"));
});
