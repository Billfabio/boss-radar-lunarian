import {readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const skip=new Set(['node_modules','.git','cloud']);
async function walk(dir){
 const out=[];for(const e of await readdir(dir,{withFileTypes:true})){if(skip.has(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else if(/\.(?:mjs|js)$/.test(e.name))out.push(p);}return out;
}
const files=await walk(root.pathname);let failed=0;
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){failed++;console.error('\n'+relative(root.pathname,file)+'\n'+r.stderr);}}
if(failed){console.error('\n'+failed+' arquivo(s) com erro de sintaxe.');process.exit(1);}
console.log(files.length+' arquivos JavaScript/MJS verificados.');
