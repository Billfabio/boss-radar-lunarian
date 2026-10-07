import assert from 'node:assert/strict';
import assets from './assets.generated.mjs';
import {createHostedServer} from './server.generated.mjs';
const files=new Map(),origin='https://boss-radar.example.workers.dev';
const context={origin,mkdir:async()=>{},readFile:async(path,encoding)=>{const v=files.get(path)||(assets[path]?Buffer.from(assets[path],'base64'):null);if(!v){const e=new Error('missing');e.code='ENOENT';throw e;}return encoding?v.toString(encoding):v;},writeFile:async(path,value)=>files.set(path,Buffer.from(value)),rename:async(from,to)=>{files.set(to,files.get(from));files.delete(from);}};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:503});
try{
 assert.ok(assets['/app/ai-lab-ui.mjs'],'AI Lab UI precisa estar no pacote Cloudflare');
 assert.ok(assets['/app/system-health-ui.mjs'],'System Health UI precisa estar no pacote Cloudflare');
 const call=async(app,path,body,token)=>{let code,result;const req={method:body?'POST':'GET',url:path,headers:{host:new URL(origin).host,origin,'x-boss-token':token},on(){},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}};const res={writeHead(c){code=c;},end(s){result=s;},write(){}};await app.handler(req,res);assert.equal(code,200,String(result));return result;};
 const app=await createHostedServer(context),first=JSON.parse(await call(app,'/api/state'));await call(app,'/api/settings',{progress:{Dharalion:{kills:2,known:true}}},first.token);
 const restored=await createHostedServer(context),second=JSON.parse(await call(restored,'/api/state'));assert.equal(second.settings.progress.Dharalion.kills,2);assert.match((await call(restored,'/')).toString(),/Imagens importadas/);
 assert.match((await call(restored,'/ai-lab-ui.mjs')).toString(),/initAILabUI/);
 assert.match((await call(restored,'/system-health-ui.mjs')).toString(),/renderSystemHealth/);
 const aiLab=JSON.parse(await call(restored,'/api/intelligence/ai-lab'));assert.equal(aiLab.policy.auto_model_promotion,false);assert.ok(aiLab.champion);
 const discovery=JSON.parse(await call(restored,'/api/intelligence/discovery'));assert.equal(discovery.canonicalEventCount,0);assert.equal(discovery.candidates.length,3);assert.equal(discovery.nextBestBoss.length,0);assert.match((await call(restored,'/discovery-ui.mjs')).toString(),/discoveryHtml/);
 const candidate=JSON.parse(await call(restored,'/api/intelligence/discovery/candidate',{name:'Public evaluation',url:'https://example.org/public'},second.token));assert.equal(candidate.mode,'shadow');const run=JSON.parse(await call(restored,'/api/intelligence/discovery/run',{},second.token));assert.equal(run.status,'AMOSTRA_INSUFICIENTE');const date=Date.parse('2025-01-01T00:00:00-03:00');const replay=JSON.parse(await call(restored,'/api/intelligence/discovery/historical',{startAt:date,endAt:date+86400000-1},second.token));assert.ok(replay.timeline.every(t=>t.events.length===0&&t.alerts.length===0));
 console.log('Servidor hospedado: origem HTTPS, APIs, AI Lab, System Health, assets, restauração e Data Intelligence passaram.');
}finally{globalThis.fetch=originalFetch;}
