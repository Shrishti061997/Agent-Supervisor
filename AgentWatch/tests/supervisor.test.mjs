import test from 'node:test';
import assert from 'node:assert/strict';
import app,{evaluate,makePdf} from '../worker/server.js';

class Bucket {
  values=new Map();
  version=0;
  async get(k){const value=this.values.get(k);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null;}
  async put(k,text,opts={}){const old=this.values.get(k);if(opts.onlyIf && old?.etag!==opts.onlyIf.etagMatches)return null;const etag=String(++this.version);this.values.set(k,{etag,text});return {etag};}
}
const env={BUCKET:new Bucket()};
const base='https://demo.test';
async function call(path,body){const r=await app.fetch(new Request(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',Origin:base}:{},body:body?JSON.stringify(body):undefined}),env);const type=r.headers.get('Content-Type')||'';return {status:r.status,data:type.includes('json')?await r.json():await r.arrayBuffer()};}
async function start(scenario='privacy',mode='scripted'){return (await call('/api/runs',{scenario,mode})).data;}
async function step(s,extra={}){const r=await call('/api/runs/'+s.id+'/step',extra);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function control(s,command,extra={}){return (await call('/api/runs/'+s.id+'/control',{command,...extra})).data;}
const valid={tool:'create_pdf',args:{path:'/output/sales-report.pdf',totalRevenue:45000,totalCosts:27500,profit:17500,summary:'Revenue increased each month across the supplied three-month period.'}};
const state={policy:{sourcesOnly:false},reads:['/workspace/sales.csv']};

test('approved read allowed; arbitrary, relative, and traversal reads denied',()=>{
  assert.equal(evaluate({tool:'read_file',args:{path:'/workspace/sales.csv'}},state).decision,'ALLOW');
  for(const path of ['/confidential/employee-salaries.csv','../../secret','/workspace/../confidential/secret','/workspace/sales.csv/../secret','/workspace\\sales.csv','/workspace/sales.csv\0'])assert.equal(evaluate({tool:'read_file',args:{path}},state).decision,'BLOCK',path);
});
test('unknown tool and shell execution never run',()=>{assert.equal(evaluate({tool:'exec',args:{command:'cat /secret'}},state).decision,'BLOCK');});
test('output provenance, path, totals, and narrative are checked',()=>{
  assert.equal(evaluate(valid,state).decision,'ALLOW');
  assert.equal(evaluate(valid,{...state,reads:[]}).decision,'BLOCK');
  assert.equal(evaluate({...valid,args:{...valid.args,path:'/etc/report.pdf'}},state).decision,'BLOCK');
  assert.equal(evaluate({...valid,args:{...valid.args,totalRevenue:47000}},state).decision,'HOLD');
  assert.equal(evaluate({...valid,args:{...valid.args,summary:'Revenue will double next year.'}},state).decision,'HOLD');
  assert.equal(evaluate({...valid,args:{...valid.args,summary:'password: private'}},state).decision,'BLOCK');
});
test('network gate prevents SSRF, credentials in URLs, and arbitrary hosts',()=>{
  for(const url of ['http://example.com/','https://127.0.0.1/','https://example.com.evil.test/','https://user:password@example.com/','https://example.com/?private=123'])assert.equal(evaluate({tool:'fetch_url',args:{url}},state).decision,'BLOCK',url);
  assert.equal(evaluate({tool:'fetch_url',args:{url:'https://example.com/'}},state).decision,'HOLD');
});
test('confidential action blocked before access count changes; no PDF released early',async()=>{
  let s=await start();s=await step(s);assert.equal(s.accesses,0);assert.equal(s.proposalReady,true);s=await step(s);assert.equal(s.accesses,1);s=await step(s);assert.equal(s.blocked,1);assert.equal(s.accesses,1);assert.equal(s.reads.length,1);
  assert.equal((await call('/api/runs/'+s.id+'/pdf')).status,409);
  assert.ok(!JSON.stringify(s).includes('salary_amount'));s=await step(s);assert.equal(s.status,'waiting');
  s=await control(s,'redirect',{guidance:'Use only the supplied file.'});assert.equal(s.policy.sourcesOnly,true);s=await step(s);assert.equal(s.report,null);s=await step(s);assert.ok(s.report);s=await step(s);s=await step(s);assert.equal(s.status,'completed');
  const pdf=await call('/api/runs/'+s.id+'/pdf');assert.equal(pdf.status,200);assert.ok(new TextDecoder().decode(pdf.data).startsWith('%PDF-1.4'));
  assert.equal((await call('/api/runs/'+s.id+'/audit')).data.report.totalRevenue,45000);
});
test('wrong totals held; repair is rechecked before release',async()=>{
  let s=await start('accuracy');s=await step(s);s=await step(s);s=await step(s);assert.equal(s.status,'waiting');assert.equal(s.report,null);assert.equal(s.pendingRepair,true);
  assert.equal((await call('/api/runs/'+s.id+'/control',{command:'approve'})).status,409);
  s=await control(s,'repair');s=await step(s);assert.equal(s.report.totalRevenue,45000);assert.ok(s.events.some(e=>e.kind==='allow'&&e.title.includes('source-consistency') || e.title.includes('execution recheck')));s=await step(s);s=await step(s);assert.equal(s.status,'completed');
});
test('pause/resume and stop prevent further scheduling',async()=>{
  let s=await start('clean');s=await control(s,'pause');assert.equal((await call('/api/runs/'+s.id+'/step',{})).status,409);s=await control(s,'resume');s=await step(s);s=await control(s,'stop');assert.equal(s.status,'stopped');assert.equal(s.report,null);assert.equal((await call('/api/runs/'+s.id+'/step',{})).status,409);assert.equal((await call('/api/runs/'+s.id+'/pdf')).status,409);
});
test('stop during a model request invalidates its proposal lease',async()=>{
  let resolveModel,entered;const ready=new Promise(r=>entered=r);const previous=globalThis.fetch;
  globalThis.fetch=async()=>{entered();return new Promise(r=>resolveModel=()=>r(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({tool:'read_file',args:{path:'/workspace/sales.csv'},purpose:'Read source'})}}]}),{headers:{'Content-Type':'application/json'}})));};
  try{let s=await start('clean','tokenrouter');const pending=step(s,{apiKey:'test-key-not-secret',model:'test-model'});await ready;s=await control(s,'stop');resolveModel();const result=await pending;assert.equal(result.status,'stopped');assert.equal(result.accesses,0);assert.equal(result.reads.length,0);assert.ok(!JSON.stringify(result).includes('test-key-not-secret'));}finally{globalThis.fetch=previous;}
});
test('model errors fail closed; no implicit scripted fallback',async()=>{let s=await start('clean','tokenrouter');s=await step(s);assert.equal(s.status,'paused');assert.equal(s.accesses,0);assert.equal(s.report,null);});
test('model purpose review can hold an otherwise approved read',async()=>{
  const previous=globalThis.fetch;let n=0;
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(++n===1?{tool:'read_file',args:{path:'/workspace/sales.csv'},purpose:'Read approved source'}:{decision:'HOLD',reason:'The requested task purpose needs clarification.'})}}]}),{headers:{'Content-Type':'application/json'}});
  try{let s=await start('clean','tokenrouter');s=await step(s,{apiKey:'test-only',model:'test-model'});assert.equal(s.status,'waiting');assert.equal(s.accesses,0);assert.equal(n,2);assert.ok(s.events.some(e=>e.kind==='review'));}finally{globalThis.fetch=previous;}
});
test('a queued read can be stopped before execution',async()=>{let s=await start('clean');s=await step(s);assert.equal(s.proposalReady,true);assert.equal(s.accesses,0);s=await control(s,'stop');assert.equal((await call('/api/runs/'+s.id+'/step',{})).status,409);assert.equal(s.accesses,0);});
test('cross-origin mutations rejected',async()=>{const r=await app.fetch(new Request(base+'/api/runs',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{}'}),env);assert.equal(r.status,403);});
test('artifact hash and PDF bytes use stable source-backed content',()=>{const b=makePdf({runId:'sample-run',createdAt:'2026-10-10T21:00:00.000Z'});assert.ok(b.length>1000);const text=new TextDecoder().decode(b);assert.ok(text.includes('$45,000'));assert.ok(!text.includes('$47,000'));assert.ok(text.includes('%%EOF'));});
