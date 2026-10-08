export const EXTENSION_PACKAGE_FILES=['manifest.json','adapter.js','collector-core.js','background.js','content.js','popup.html','popup.js','popup.css','LEIA-ME.md'];
let crcTable=null;
function table(){if(crcTable)return crcTable;crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});return crcTable;}
function crc32(bytes){let c=0xffffffff,t=table();for(const b of bytes)c=t[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
const header=(size,write)=>{const b=Buffer.alloc(size);write(b);return b;};
export function buildStoredZip(entries){
 const locals=[],centrals=[];let offset=0;const dosTime=0,dosDate=33;
 for(const entry of entries){const name=Buffer.from(entry.name),data=Buffer.isBuffer(entry.content)?entry.content:Buffer.from(entry.content),crc=crc32(data);
  const local=header(30,b=>{b.writeUInt32LE(0x04034b50,0);b.writeUInt16LE(20,4);b.writeUInt16LE(0,6);b.writeUInt16LE(0,8);b.writeUInt16LE(dosTime,10);b.writeUInt16LE(dosDate,12);b.writeUInt32LE(crc,14);b.writeUInt32LE(data.length,18);b.writeUInt32LE(data.length,22);b.writeUInt16LE(name.length,26);b.writeUInt16LE(0,28);});
  locals.push(local,name,data);
  const central=header(46,b=>{b.writeUInt32LE(0x02014b50,0);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt16LE(0,8);b.writeUInt16LE(0,10);b.writeUInt16LE(dosTime,12);b.writeUInt16LE(dosDate,14);b.writeUInt32LE(crc,16);b.writeUInt32LE(data.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(name.length,28);b.writeUInt16LE(0,30);b.writeUInt16LE(0,32);b.writeUInt16LE(0,34);b.writeUInt16LE(0,36);b.writeUInt32LE(0,38);b.writeUInt32LE(offset,42);});centrals.push(central,name);offset+=local.length+name.length+data.length;
 }
 const centralSize=centrals.reduce((n,b)=>n+b.length,0),end=header(22,b=>{b.writeUInt32LE(0x06054b50,0);b.writeUInt16LE(0,4);b.writeUInt16LE(0,6);b.writeUInt16LE(entries.length,8);b.writeUInt16LE(entries.length,10);b.writeUInt32LE(centralSize,12);b.writeUInt32LE(offset,16);b.writeUInt16LE(0,20);});return Buffer.concat([...locals,...centrals,end]);
}
export async function buildExtensionPackage(readFile,root){
 const entries=[];for(const name of EXTENSION_PACKAGE_FILES)entries.push({name,content:await readFile(root+'/edge-extension/'+name)});return buildStoredZip(entries);
}
