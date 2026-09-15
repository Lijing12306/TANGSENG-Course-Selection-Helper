import { encryptPassword, inspectKey, b64ToBuf } from './rsa.js';
import {
  extractHiddenConfig, hasLoginForm,
} from './html-extract.js';
import {
  AuthError, CaptchaRequiredError, CasRequiredError,
} from '../core/errors.js';
import { logger } from '../core/logger.js';

const LOGIN_FAIL_PATTERNS = [
  /用户名或密码错误/, /密码错误/, /用户不存在/, /账号不存在/,
  /密码输入错误/, /用户名错误/, /账号或密码/,
];
const CAPTCHA_PATTERNS = [
  /验证码输入错误/, /验证码错误/, /请输入验证码/, /验证码不能为空/, /验证码已过期/,
];
const LOGIN_OK_PATTERNS = [/index_initMenu/, /xtgl\/index/];

function extractTips(html) {
  const m = String(html).match(/<p[^>]*id=["']tips["'][^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').trim();
}

function classifyLoginResponse(res) {
  const loc = res.location || '';
  const text = res.text || '';
  if (res.status >= 300 && res.status < 400) {
    if (LOGIN_OK_PATTERNS.some((re) => re.test(loc))) return { ok: true, reason: `302 → ${loc}` };
    return { ok: false, reason: `302 → ${loc || '(无 Location)'}`, raw: loc };
  }
  for (const re of CAPTCHA_PATTERNS) {
    if (re.test(text)) return { ok: false, captcha: true, reason: extractTips(text) || '需要验证码', raw: text.slice(0, 300) };
  }
  for (const re of LOGIN_FAIL_PATTERNS) {
    if (re.test(text)) {
      const m = text.match(re);
      return { ok: false, reason: extractTips(text) || `服务器返回：${m[0]}`, raw: text.slice(0, 300) };
    }
  }
  const tips = extractTips(text);
  if (tips) return { ok: false, reason: tips, raw: text.slice(0, 300) };
  if (hasLoginForm(text)) return { ok: false, reason: '返回登录页（账号或密码可能错误）', raw: text.slice(0, 300) };
  if (LOGIN_OK_PATTERNS.some((re) => re.test(text))) return { ok: true, reason: '200 且已进入系统' };
  return { ok: false, reason: `未识别的响应 (status=${res.status})`, raw: text.slice(0, 300) };
}

export async function fetchCaptcha(session) {
  const res = await session.raw({
    url: `${session.abs(session.config.session.captchaPath || '/jwglxt/kaptcha')}?time=${Date.now()}`,
    method: 'GET',
    priority: 5,
  });
  const isImage = /image/i.test(res.contentType || '');
  const dataUrl = isImage && res.buf
    ? `data:${res.contentType.split(';')[0]};base64,${res.buf.toString('base64')}`
    : null;
  return { dataUrl, contentType: res.contentType, status: res.status };
}

export async function performLogin(session, { username, password, yzm } = {}) {
  const config = session.config;
  const user = username ?? config.account?.username ?? session.credentials?.username;
  const pass = password ?? config.account?.password ?? session.credentials?.password;

  if (!user || !pass) {
    throw new AuthError('缺少学号或密码，请在【设置】中填写');
  }

  logger.info('开始登录', { username: user });

  // 1. 获取登录页
  const loginUrl = session.abs(config.session.loginPath);
  const page = await session.raw({ url: loginUrl, method: 'GET', priority: 5 });
  if (page.status >= 300 && page.status < 400 && !/login_slogin/.test(page.location || '')) {
    throw new CasRequiredError(`登录页被重定向到 ${page.location}，可能启用了强制统一身份认证`, page.location);
  }
  if (page.status >= 400) throw new AuthError(`无法打开登录页 (HTTP ${page.status})`);

  const cfg = extractHiddenConfig(page.text);
  logger.debug('登录页配置', cfg);
  if (!cfg.csrftoken) logger.warn('未从登录页解析到 csrftoken，仍尝试提交');

  // 2. 获取 RSA 公钥
  const keyRes = await session.raw({ url: `${session.abs(config.session.publicKeyPath)}?time=${Date.now()}`, method: 'GET', priority: 5 });
  let key = null;
  try { key = JSON.parse(keyRes.text); } catch { key = null; }
  if (!key || !key.modulus || !key.exponent) {
    throw new AuthError(`获取 RSA 公钥失败：${keyRes.text.slice(0, 120)}`);
  }
  logger.debug('RSA 公钥', inspectKey(key.modulus, key.exponent));

  // 3. 登录前退出旧会话
  if (config.session.preLoginLogout) {
    try {
      await session.raw({
        url: session.abs(config.session.logoutAccountPath),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Referer: loginUrl },
        body: new URLSearchParams({ csrfTokenLogout: cfg.csrftoken || '' }).toString(),
        priority: 5,
      });
    } catch (err) {
      logger.debug('预登出请求失败（忽略）', err.message);
    }
  }

  // 4. 加密密码
  const needEncrypt = cfg.mmsfjm !== '0';
  const mm = needEncrypt
    ? encryptPassword(pass, key.modulus, key.exponent, { method: 'js' })
    : pass;

  // 5. 提交登录
  const body = new URLSearchParams();
  if (cfg.csrftoken) body.set('csrftoken', cfg.csrftoken);
  body.set('language', 'zh_CN');
  body.set('ydType', '');
  body.set('yhm', user);
  body.set('mm', mm);
  body.set('yzm', yzm || '');

  const res = await session.raw({
    url: `${session.abs(config.session.loginPath)}?time=${Date.now()}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Origin: session.origin,
      Referer: loginUrl,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
    priority: 5,
  });

  const verdict = classifyLoginResponse(res);
  if (verdict.ok) {
    session.markLoggedIn();
    logger.info(`登录成功：${verdict.reason}`);
    return { ok: true, message: verdict.reason };
  }
  if (verdict.captcha) {
    session.markLoggedOut();
    const captcha = await fetchCaptcha(session);
    const err = new CaptchaRequiredError(
      yzm ? '验证码错误，请输入新的验证码' : '该账号密码登录需要验证码',
      verdict.raw,
    );
    err.captchaDataUrl = captcha.dataUrl;
    err.captchaAvailable = Boolean(captcha.dataUrl);
    throw err;
  }
  session.markLoggedOut();
  throw new AuthError(verdict.reason, verdict.raw);
}

export function describeKey(modulusB64, exponentB64) {
  const info = inspectKey(modulusB64, exponentB64);
  return { ...info, sampleModulusHex: b64ToBuf(modulusB64).subarray(0, 8).toString('hex') };
}
