import {DurableObject} from 'cloudflare:workers';
import {createHostedServer} from './server.generated.mjs';
import assets from './assets.generated.mjs';
import {authenticated,equal,issueCookie,loginPage} from './auth.mjs';
function unavailable(){return new Response('Configure a senha SITE_PASSWORD antes de abrir o painel.',{status:503});}
export default {
 async fetch(request,env){const url=new URL(request.url),password=env.SITE_PASSWORD;if(!password||password.length<12)return unavailable();if(Number(request.headers.get('content-length'))>400000)return new Response('Envio grande demais',{status:413});
  if(url.pathname==='/login'&&request.method==='POST'){if(request.headers.get('origin')!==url.origin)return new Response('Origem inválida',{status:403});const data=await request.formData();if(!equal(data.get('password'),password))return new Response('Senha incorreta. Volte e tente novamente.',{status:403,headers:{'Cache-Control':'no-store'}});return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':`boss_session=${issueCookie(password)}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`}});}
  if(!url.pathname.startsWith('/extension/')&&!authenticated(request,password))return loginPage();
  const id=env.RADAR.idFromName('owner-radar');return env.RADAR.get(id).fetch(request);
 }
};
export class BossRadar extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.queue=Promise.resolve();this.ready=ctx.blockConcurrencyWhile(async()=>{
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS radar_files (path TEXT NOT NULL, part INTEGER NOT NULL, content BLOB NOT NULL, PRIMARY KEY(path,part))');
  const sql=ctx.storage.sql,readFile=async(path,encoding)=>{let chunks=[...sql.exec('SELECT content FROM radar_files WHERE path=? ORDER BY part',path)].map(r=>Buffer.from(r.content));let value;if(chunks.length)value=Buffer.concat(chunks);else if(assets[path])value=Buffer.from(assets[path],'base64');else{const e=new Error('Arquivo não encontrado');e.code='ENOENT';throw e;}return encoding?value.toString(encoding):value;};
  const writeFile=async(path,value)=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);ctx.storage.transactionSync(()=>{sql.exec('DELETE FROM radar_files WHERE path=?',path);for(let i=0;i<Math.max(1,bytes.length);i+=60000)sql.exec('INSERT INTO radar_files VALUES (?,?,?)',path,Math.floor(i/60000),new Uint8Array(bytes.subarray(i,i+60000)));});};
  const rename=async(from,to)=>ctx.storage.transactionSync(()=>{sql.exec('DELETE FROM radar_files WHERE path=?',to);sql.exec('UPDATE radar_files SET path=? WHERE path=?',to,from);});
  this.context={readFile,writeFile,rename,mkdir:async()=>{},origin:null};
 });}
 async fetch(request){await this.ready;const task=this.queue.then(async()=>{const origin=new URL(request.url).origin;if(!this.app){this.context.origin=origin;this.app=await createHostedServer(this.context);}
   if(!await this.ctx.storage.get('origin'))await this.ctx.storage.put('origin',origin);const headers=Object.fromEntries(request.headers);headers.host=new URL(request.url).host;const url=new URL(request.url);const bytes=request.method==='POST'?new Uint8Array(await request.arrayBuffer()):new Uint8Array();const req={method:request.method,url:url.pathname+url.search,headers,on(){},async *[Symbol.asyncIterator](){if(bytes.length)yield Buffer.from(bytes);}};
   let status=200,responseHeaders={},payload=null,finished=false;const res={writeHead(code,h){status=code;responseHeaders=h||{};},write(){},end(data){payload=data||null;finished=true;}};
   await this.app.handler(req,res);if(!finished)throw new Error('Resposta não concluída');if(!await this.ctx.storage.getAlarm())await this.ctx.storage.setAlarm(Date.now()+60000);return new Response(payload,{status,headers:responseHeaders});
  });this.queue=task.catch(()=>{});return task;}
 async alarm(){await this.ready;const task=this.queue.then(async()=>{try{if(!this.app){const origin=await this.ctx.storage.get('origin');if(origin){this.context.origin=origin;this.app=await createHostedServer(this.context);}}if(this.app)await this.app.poll();}finally{await this.ctx.storage.setAlarm(Date.now()+60000);}});this.queue=task.catch(()=>{});return task;}
}
