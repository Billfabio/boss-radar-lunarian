import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const roots=['prediction','learning','intelligence','metrics','sources','normalization','deduplication'],violations=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(/\.m?js$/.test(e.name)){const c=await readFile(p,'utf8');if(/Math\.random\s*\(/.test(c))violations.push(p+': Math.random não é permitido no motor');if(/\b(?:mock|fake|fixture|dummy)\b/i.test(c))violations.push(p+': marcador de dado simulado encontrado');}}}
for(const dir of roots)await walk(dir);
if(violations.length){console.error(violations.join('\n'));process.exit(1);}
console.log('Núcleo de inteligência sem aleatoriedade ou dados simulados.');
