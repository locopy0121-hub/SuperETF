const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read=path=>fs.readFileSync(path,'utf8');
const workflow=read('.github/workflows/build-apk.yml');
const packageData=require('../package.json');
const capacitor=require('../capacitor.config.json');
const guard=read('scripts/verify-apk.sh');
const ignored=read('.gitignore');

test('Version 1.4.6 and original Android identity remain explicit',()=>{
 assert.equal(packageData.version,'1.4.6');
 assert.equal(capacitor.version,'1.4.6');
 assert.equal(capacitor.appId,'com.locopy.superetf');
 assert.equal((1*10000+4*100+6),10406);
});
test('Preview package is isolated from already-installed original signer',()=>{
 assert.match(workflow,/applicationIdSuffix "\.preview\.v146"/);
 assert.match(workflow,/com\.locopy\.superetf\.preview\.v146/);
 assert.match(workflow,/versionNameSuffix "-preview"/);
 assert.match(workflow,/src\/debug\/res\/values\/strings\.xml/);
 assert.match(workflow,/assembleDebug/);
 assert.match(workflow,/SuperETF-v.*-preview\.apk/);
});
test('Original app requires private protected release signing',()=>{
 for(const secret of ['SUPERETF_KEYSTORE_BASE64','SUPERETF_STORE_PASSWORD',
   'SUPERETF_KEY_ALIAS','SUPERETF_KEY_PASSWORD'])
   assert.ok(workflow.includes('secrets.'+secret),'Missing protected secret '+secret);
 assert.match(workflow,/steps\.signing\.outputs\.configured == 'true'/);
 assert.match(workflow,/assembleRelease/);
 assert.match(workflow,/SuperETF-v.*-signed\.apk/);
 assert.match(workflow,/com\.locopy\.superetf/);
 assert.match(workflow,/E5A3E1C27E39E0E72A55E191882D0F54759A55165737CDA51A6125CC508AFF9F/);
});
test('CI checks signature and package identity before upload',()=>{
 assert.match(workflow,/scripts\/verify-apk\.sh/);
 assert.match(guard,/apksigner.*verify/);
 assert.match(guard,/dump badging/);
 assert.match(guard,/versionCode/);
 assert.match(guard,/certificate SHA-256/);
});
test('Public repository prevents accidental private key commits',()=>{
 for(const value of ['*.jks','*.p12','*.keystore','*signing-secrets*'])
  assert.ok(ignored.includes(value));
 assert.doesNotMatch(workflow,/\bstorePassword ["'](?:android|password|secret)\b/i);
});
