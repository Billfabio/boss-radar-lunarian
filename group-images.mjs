import {createHash} from 'node:crypto';
export function decodeGroupImage(data){
 if(typeof data!=='string'||data.length>300000)throw new Error('Imagem grande demais. Use a versão reduzida da extensão.');
 const match=data.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)throw new Error('Formato de imagem inválido');const bytes=Buffer.from(match[2],'base64');
 const valid=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 if(!valid||bytes.length<12||bytes.length>220000)throw new Error('Conteúdo de imagem inválido');return {bytes,type:'image/'+match[1],hash:createHash('sha256').update(bytes).digest('hex')};
}
