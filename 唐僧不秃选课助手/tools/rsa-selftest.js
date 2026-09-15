import crypto from 'node:crypto';
import { buildPublicPem, inspectKey, encryptPassword, b64ToBuf } from '../src/auth/rsa.js';

const MODULUS = 'AIEZbxaS+aSA6CUmivinSoovYOyJQnm1FM0d3JpUXiGHxFm+EaHf4HLBlWyQKOs0GrY3Qs9PXH8QX4ldS+tt7HXOdsBBWNlv+9Q8NCsloC9jWWLtM8Lfa3SfFRjraIFuW3TbUHVocF04vWj15Fsq2gQlO5I4L2ctGHjCpcgWnL1z';
const EXPONENT = 'AQAB';

let failed = 0;
function check(name, cond, extra = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  if (!cond) failed += 1;
  process.stdout.write(`[${mark}] ${name}${extra ? `  ${extra}` : ''}\n`);
}

process.stdout.write('=== RSA 自测（使用实测抓取的公钥） ===\n');

const info = inspectKey(MODULUS, EXPONENT);
check('modulus 解码字节数为 129（含 1 个符号字节）', info.modulusBytes === 129, `实际 ${info.modulusBytes}`);
check('首字节是 0x00（符号字节）', info.firstBytes.startsWith('00'), `实际 ${info.firstBytes}`);
check('推断位数为 1024', info.bits === 1024, `实际 ${info.bits}`);
check('exponent = 0x010001 (65537)', info.exponent.replace(/^0+/, '') === '10001', `实际 0x${info.exponent}`);

const pem = buildPublicPem(MODULUS, EXPONENT);
check('PEM 头正确', pem.startsWith('-----BEGIN PUBLIC KEY-----'));

let keyObj = null;
try {
  keyObj = crypto.createPublicKey(pem);
  const det = keyObj.asymmetricKeyDetails || {};
  check('Node 可解析 PEM', true);
  check('OpenSSL 识别 modulusLength = 1024', det.modulusLength === 1024, `实际 ${det.modulusLength}`);
} catch (err) {
  check('Node 可解析 PEM', false, err.message);
}

const enc = encryptPassword('test-password-123', MODULUS, EXPONENT, { method: 'js' });
const encBuf = Buffer.from(enc, 'base64');
check('纯JS 密文长度为 128 字节', encBuf.length === 128, `实际 ${encBuf.length}`);

try {
  const enc2 = encryptPassword('test-password-123', MODULUS, EXPONENT, { method: 'openssl' });
  check('OpenSSL 路径密文长度为 128 字节', Buffer.from(enc2, 'base64').length === 128,
    `实际 ${Buffer.from(enc2, 'base64').length}`);
} catch (err) {
  check('OpenSSL 路径可用', false, err.message);
}

const a = encryptPassword('same', MODULUS, EXPONENT, { method: 'js' });
const b = encryptPassword('same', MODULUS, EXPONENT, { method: 'js' });
check('随机填充导致两次密文不同（符合 PKCS#1 v1.5）', a !== b);

const modulusHex = b64ToBuf(MODULUS).toString('hex');
process.stdout.write(`\nmodulus 十六进制（前 40 字符）：${modulusHex.slice(0, 40)}\n`);
process.stdout.write(`PEM:\n${pem}`);
process.stdout.write('\n可用 `openssl rsa -pubin -text -noout -in pub.pem` 核对 Modulus 是否与抓包一致。\n');

process.stdout.write(`\n结果：${failed === 0 ? '全部通过 ✅' : `${failed} 项失败 ❌`}\n`);
process.exit(failed === 0 ? 0 : 1);
