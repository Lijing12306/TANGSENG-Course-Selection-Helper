import { store } from '../src/core/config.js';
import { Session } from '../src/auth/session.js';
import { extractHiddenConfig } from '../src/auth/html-extract.js';
import { encryptPassword, inspectKey, buildPublicPem } from '../src/auth/rsa.js';
import { logger } from '../src/core/logger.js';

export async function doctor() {
  const config = store.load();
  const session = new Session(config);
  const lines = [];
  const push = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };

  push('=== 1) 打开登录页 ===');
  const page = await session.raw({ url: session.abs(config.session.loginPath), method: 'GET' });
  push(`  status = ${page.status}`);
  push(`  content-type = ${page.contentType}`);
  push(`  location = ${page.location || '(无)'}`);
  const cfg = extractHiddenConfig(page.text);
  push(`  csrftoken = ${cfg.csrftoken ? `${cfg.csrftoken.slice(0, 18)}...` : '(未解析到)'}`);
  push(`  mmsfjm=${cfg.mmsfjm}  dlsfbxyzm=${cfg.dlsfbxyzm}  dxsyrz=${cfg.dxsyrz}  xxdm=${cfg.xxdm}  userPolicyOn=${cfg.userPolicyOn}`);
  push(`  authJwglxtLoginURL = ${cfg.authJwglxtLoginURL || '(空)'}`);

  push('=== 2) 获取 RSA 公钥 ===');
  const keyRes = await session.raw({ url: `${session.abs(config.session.publicKeyPath)}?time=${Date.now()}`, method: 'GET' });
  let key = null;
  try { key = JSON.parse(keyRes.text); } catch { key = null; }
  if (!key) {
    push('  [失败] 未拿到公钥 JSON');
  } else {
    const info = inspectKey(key.modulus, key.exponent);
    push(`  modulus base64 长度 = ${key.modulus.length}`);
    push(`  解码字节数 = ${info.modulusBytes}  首字节 = ${info.firstBytes}`);
    push(`  推断位数 = ${info.bits} bit   exponent = 0x${info.exponent}`);
    push(`  期望密文长度 = ${info.modulusBytes - (info.firstBytes.startsWith('00') ? 1 : 0)} 字节`);
  }

  push('=== 3) RSA 加密自测 ===');
  if (key) {
    const enc = encryptPassword('test-password-123', key.modulus, key.exponent, { method: 'js' });
    push(`  纯JS加密结果长度 = ${enc.length} (base64)`);
    try {
      encryptPassword('test-password-123', key.modulus, key.exponent, { method: 'openssl' });
      push('  纯JS加密 / OpenSSL加密 均可用 ✅');
    } catch (err) {
      push(`  [OpenSSL 加密不可用] ${err.message}（已自动只用纯JS实现，不影响）`);
    }
    push(`  PEM 前两行:\n${buildPublicPem(key.modulus, key.exponent).split('\n').slice(0, 2).join('\n')}`);
  }

  push('=== 4) Cookie 与会话 ===');
  const st = session.status();
  push(`  cookies = ${st.cookies.join(', ') || '(无)'}`);
  push(`  JSESSIONID = ${st.hasJSession ? '有' : '无'}   route = ${st.hasRoute ? '有' : '无'}`);

  push('=== 5) 接口校准状态 ===');
  push(`  actions.json calibrated = ${store.isCalibrated()}`);
  if (!store.isCalibrated()) push('  → 选课接口尚未校准，请先完成【抓包导入】');

  push('=== 6) 账号配置 ===');
  push(`  username = ${st.username || '(未配置)'}  password = ${session.credentials?.password ? '已配置' : '(未配置)'}`);

  push('');
  push('doctor 完成。若第 2、3 步正常，说明加密链路可用，可继续 `login` 验证账号密码。');
  return lines.join('\n');
}

export async function runDoctor() {
  try {
    await doctor();
    return 0;
  } catch (err) {
    logger.error('doctor 失败', err);
    process.stderr.write(`\n[失败] ${err.message}\n`);
    if (err.detail) process.stderr.write(`详情：${String(err.detail).slice(0, 400)}\n`);
    return 1;
  }
}
