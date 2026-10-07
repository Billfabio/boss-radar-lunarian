import {createHash} from 'node:crypto';
import {ensureOperational,appendOperationalEvent} from './operational-state.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function validateSnapshot(value){if(!value||typeof value!=='object')throw new Error('Snapshot não é objeto');if(!value.settings||typeof value.settings!=='object')throw new Error('Snapshot sem settings');if(!Array.isArray(value.checks)&&value.checks!=null)throw new Error('Snapshot checks inválido');if(value.intelligence&&!Array.isArray(value.intelligence.events))throw new Error('Snapshot intelligence.events inválido');return true;}
export function createBackupManager({state,readFile,writeFile,rename,mkdir,dataDir}={}){
 const o=ensureOperational(state),base=dataDir+'/backups';
 async function backup(at=Date.now()){
  await mkdir(base,{recursive:true});const slot=Math.floor(at/(6*3600000))%2?'B':'A',path=base+'/state-'+slot+'.json',tmp=path+'.tmp',snapshot=JSON.stringify(state),hash=sha(snapshot);await writeFile(tmp,snapshot);await rename(tmp,path);const read=await readFile(path,'utf8');if(sha(read)!==hash)throw new Error('Hash do backup divergiu após gravação');validateSnapshot(JSON.parse(read));const meta={slot,path,hash,bytes:Buffer.byteLength(read),createdAt:at,verifiedAt:Date.now()};o.backups.slots[slot]=meta;o.backups.lastBackupAt=at;appendOperationalEvent(state,'BACKUP_CREATED',{slot,path,hash,bytes:meta.bytes},{at,idempotencyKey:'backup:'+Math.floor(at/(6*3600000))});return meta;
 }
 async function restoreTest(slot=null,at=Date.now()){
  const selected=slot&&o.backups.slots[slot]?o.backups.slots[slot]:Object.values(o.backups.slots).sort((a,b)=>b.createdAt-a.createdAt)[0];if(!selected)throw new Error('Nenhum backup verificado disponível');const text=await readFile(selected.path,'utf8'),actual=sha(text);if(actual!==selected.hash)throw new Error('Backup alterado ou corrompido: hash divergente');const parsed=JSON.parse(text);validateSnapshot(parsed);const result={ok:true,slot:selected.slot,path:selected.path,hash:actual,bytes:Buffer.byteLength(text),createdAt:selected.createdAt,testedAt:at,events:parsed.intelligence?.events?.length||0,candidates:parsed.whatsapp?.candidates?.length||0};o.backups.lastRestoreTestAt=at;o.backups.lastRestoreTest=result;appendOperationalEvent(state,'BACKUP_RESTORE_TEST',{slot:selected.slot,ok:true,hash:actual,bytes:result.bytes},{at,idempotencyKey:'restore-test:'+selected.hash});return result;
 }
 function publicState(){return {lastBackupAt:o.backups.lastBackupAt||null,lastRestoreTestAt:o.backups.lastRestoreTestAt||null,lastRestoreTest:o.backups.lastRestoreTest||null,slots:Object.values(o.backups.slots).sort((a,b)=>b.createdAt-a.createdAt)};}
 return {backup,restoreTest,publicState};
}
