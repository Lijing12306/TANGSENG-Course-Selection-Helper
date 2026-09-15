import crypto from 'node:crypto';
import { AuthError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Base64 <-> 大数。正方前端用的是 jsbn 的 b64tohex，这里用 Node 的 base64 解码等价实现。
// ---------------------------------------------------------------------------
export function b64ToBuf(s) {
  return Buffer.from(String(s || ''), 'base64');
}

export function b64ToHex(s) {
  return b64ToBuf(s).toString('hex');
}

function bufToBigInt(buf) {
  const hex = buf.toString('hex');
  return BigInt(`0x${hex || '0'}`);
}

function bigIntToBuf(x, len) {
  let hex = x.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let buf = Buffer.from(hex, 'hex');
  if (buf.length > len) buf = buf.subarray(buf.length - len);
  else if (buf.length < len) buf = Buffer.concat([Buffer.alloc(len - buf.length), buf]);
  return buf;
}

function modPow(base, exp, mod) {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 纯 JS 的 PKCS#1 v1.5 Type-2 填充加密 —— 与正方前端 jsbn 的 rsaKey.encrypt() 完全一致
// ---------------------------------------------------------------------------
export function pkcs1v15EncryptBigInt(plain, modulusB64, exponentB64) {
  const n = bufToBigInt(b64ToBuf(modulusB64));
  const e = bufToBigInt(b64ToBuf(exponentB64));
  const nLen = b64ToBuf(modulusB64).length - (b64ToBuf(modulusB64)[0] === 0 ? 1 : 0);
  const msg = Buffer.from(String(plain), 'utf8');

  if (nLen < msg.length + 11) {
    throw new AuthError('密码过长，超出 RSA 密钥长度');
  }

  const em = Buffer.alloc(nLen);
  em[0] = 0x00;
  em[1] = 0x02;
  const psLen = nLen - msg.length - 3;
  for (let i = 2; i < 2 + psLen; i += 1) {
    let b = 0;
    do { b = crypto.randomBytes(1)[0]; } while (b === 0);
    em[i] = b;
  }
  em[2 + psLen] = 0x00;
  msg.copy(em, 3 + psLen);

  const m = bufToBigInt(em);
  const c = modPow(m, e, n);
  return bigIntToBuf(c, nLen).toString('base64');
}

// ---------------------------------------------------------------------------
// 备选：构造 PEM 后用 Node 内置 OpenSSL 加密（结果等价，仅随机填充不同）
// ---------------------------------------------------------------------------
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag, value) {
  return Buffer.concat([Buffer.from([tag]), derLen(value.length), value]);
}

function derInteger(buf) {
  let i = 0;
  while (i < buf.length - 1 && buf[i] === 0) i += 1;
  let v = buf.subarray(i);
  if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
  return derTlv(0x02, v);
}

function wrap64(b64) {
  return b64.replace(/(.{64})/g, '$1\n').trimEnd();
}

export function buildPublicPem(modulusB64, exponentB64, { pkcs1 = false } = {}) {
  const n = b64ToBuf(modulusB64);
  const e = b64ToBuf(exponentB64);
  const rsaPub = derTlv(0x30, Buffer.concat([derInteger(n), derInteger(e)]));
  let body;
  if (pkcs1) {
    body = rsaPub;
  } else {
    const algId = Buffer.from('300d06092a864886f70d0101010500', 'hex');
    body = derTlv(0x30, Buffer.concat([algId, derTlv(0x03, Buffer.concat([Buffer.from([0]), rsaPub]))]));
  }
  const label = pkcs1 ? 'RSA PUBLIC KEY' : 'PUBLIC KEY';
  return `-----BEGIN ${label}-----\n${wrap64(body.toString('base64'))}\n-----END ${label}-----\n`;
}

export function encryptWithOpenSsl(plain, modulusB64, exponentB64) {
  const pem = buildPublicPem(modulusB64, exponentB64);
  const buf = crypto.publicEncrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(String(plain), 'utf8'),
  );
  return buf.toString('base64');
}

export function encryptPassword(plain, modulusB64, exponentB64, { method = 'js' } = {}) {
  if (method === 'openssl') return encryptWithOpenSsl(plain, modulusB64, exponentB64);
  return pkcs1v15EncryptBigInt(plain, modulusB64, exponentB64);
}

export function inspectKey(modulusB64, exponentB64) {
  const n = b64ToBuf(modulusB64);
  const e = b64ToBuf(exponentB64);
  const bits = (n.length - (n[0] === 0 ? 1 : 0)) * 8;
  return {
    modulusBytes: n.length,
    bits,
    exponent: e.toString('hex'),
    firstBytes: n.subarray(0, 4).toString('hex'),
  };
}

export const _internal = { modPow, bufToBigInt, bigIntToBuf };
