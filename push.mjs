import { createECDH, createPrivateKey, randomBytes, sign, hkdfSync, createCipheriv } from 'node:crypto';

const b64 = bytes => Buffer.from(bytes).toString('base64url');
export function createVapid() {
  const key = createECDH('prime256v1'); key.generateKeys();
  const publicBytes = key.getPublicKey();
  return { publicKey: b64(publicBytes), privateKey: b64(key.getPrivateKey()) };
}
export function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname === 'web.push.apple.com' || u.hostname === 'wns2-db5p.notify.windows.com' ||
       u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export async function sendPush(subscription, message, vapid) {
  if (!allowedEndpoint(subscription.endpoint)) throw new Error('Servidor de push não suportado');
  const userKey = Buffer.from(subscription.keys.p256dh, 'base64url');
  const auth = Buffer.from(subscription.keys.auth, 'base64url');
  if (userKey.length !== 65 || auth.length !== 16) throw new Error('Inscrição inválida');
  const localKey = createECDH('prime256v1'); localKey.generateKeys();
  const senderKey = localKey.getPublicKey();
  const shared = localKey.computeSecret(userKey);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), userKey, senderKey]), 32));
  const salt = randomBytes(16);
  const contentKey = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const plain = Buffer.concat([Buffer.from(JSON.stringify(message)), Buffer.from([2])]);
  if (plain.length > 3000) throw new Error('Notificação grande demais');
  const cipher = createCipheriv('aes-128-gcm', contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4); recordSize.writeUInt32BE(4096);
  const body = Buffer.concat([salt, recordSize, Buffer.from([65]), senderKey, encrypted]);
  const publicBytes = Buffer.from(vapid.publicKey, 'base64url');
  const privateKey = createPrivateKey({ key: { kty:'EC', crv:'P-256', x:b64(publicBytes.subarray(1,33)), y:b64(publicBytes.subarray(33,65)), d:vapid.privateKey }, format:'jwk' });
  const endpoint = new URL(subscription.endpoint);
  const header = b64(Buffer.from(JSON.stringify({ typ:'JWT', alg:'ES256' })));
  const claims = b64(Buffer.from(JSON.stringify({ aud:endpoint.origin, exp:Math.floor(Date.now()/1000)+3600, sub:'https://localhost/boss-radar' })));
  const content = header + '.' + claims;
  const jwt = content + '.' + b64(sign('sha256', Buffer.from(content), { key:privateKey, dsaEncoding:'ieee-p1363' }));
  return fetch(subscription.endpoint, { method:'POST', redirect:'error', signal:AbortSignal.timeout(15000), headers:{ Authorization:`vapid t=${jwt}, k=${vapid.publicKey}`, 'Content-Encoding':'aes128gcm', 'Content-Type':'application/octet-stream', TTL:'1800', Urgency:'high' }, body });
}
