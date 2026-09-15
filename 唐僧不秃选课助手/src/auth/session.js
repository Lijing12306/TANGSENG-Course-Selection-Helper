import { buildAbsolute, isLoginPage, request } from '../http/client.js';
import { CookieJar } from '../http/cookie-jar.js';
import { RateLimiter } from '../http/rate-limiter.js';
import { hasLoginForm } from './html-extract.js';
import { performLogin } from './login.js';
import { logger } from '../core/logger.js';
import { resolveAccount } from '../core/secrets.js';
import { AuthError, SessionExpiredError } from '../core/errors.js';

export class Session {
  constructor(config) {
    this.config = config;
    this.jar = new CookieJar().load();
    this.origin = new URL(config.baseUrl).origin;
    const e = config.engine || {};
    this.limiter = new RateLimiter({
      rps: e.requestsPerSecond ?? 1,
      burstRps: e.burstRequestsPerSecond ?? 2,
      maxConcurrent: e.maxConcurrentRequests ?? 2,
    });
    this.loggedIn = false;
    this.lastCheck = 0;
    this.loginFailures = 0;
    this.loginPromise = null;
    this.credentials = null;
    this.stats = { requests: 0, logins: 0, expiries: 0 };
    this.reloadCredentials();

    if (config.session?.manualCookie) this.setManualCookie(config.session.manualCookie);
  }

  reloadCredentials() {
    this.credentials = resolveAccount(this.config);
    return this.credentials;
  }

  abs(p) { return buildAbsolute(this.config.baseUrl, p); }

  setManualCookie(raw) {
    const pairs = String(raw || '').split(';').map((s) => s.trim()).filter(Boolean);
    let n = 0;
    for (const pair of pairs) {
      const i = pair.indexOf('=');
      if (i <= 0) continue;
      this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      n += 1;
    }
    if (n) {
      this.jar.save();
      this.loggedIn = true;
      logger.info(`已载入手动 Cookie ${n} 项`);
    }
    return n;
  }

  markLoggedIn() {
    this.loggedIn = true;
    this.lastCheck = Date.now();
    this.loginFailures = 0;
    this.jar.save();
  }

  markLoggedOut() {
    this.loggedIn = false;
    this.lastCheck = 0;
  }

  clear() {
    this.jar.clear();
    this.jar.save();
    this.markLoggedOut();
  }

  async raw(opts) {
    const { priority, ...rest } = opts;
    await this.limiter.acquire({ priority: priority ?? 0 });
    try {
      this.stats.requests += 1;
      return await request({ ...rest, jar: this.jar });
    } finally {
      this.limiter.release();
      if (this.jar.dirty) this.jar.save();
    }
  }

  async login({ username, password, yzm, force = false } = {}) {
    if (!force && this.loggedIn) return { ok: true, message: '已登录' };
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      const max = this.config.session?.maxLoginAttempts ?? 3;
      let lastErr = null;
      for (let i = 0; i < max; i += 1) {
        try {
          const res = await performLogin(this, { username, password, yzm });
          this.stats.logins += 1;
          return res;
        } catch (err) {
          lastErr = err;
          if (err.code === 'CAPTCHA_REQUIRED' || err.code === 'CAS_REQUIRED') throw err;
          this.loginFailures += 1;
          logger.warn(`登录失败 (${i + 1}/${max})：${err.message}`);
          if (i < max - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
      throw lastErr || new AuthError('登录失败');
    })().finally(() => { this.loginPromise = null; });

    return this.loginPromise;
  }

  async reLogin() {
    logger.warn('会话已失效，尝试自动重登');
    this.stats.expiries += 1;
    this.markLoggedOut();
    const { username, password } = this.reloadCredentials();
    return this.login({ username, password, force: true });
  }

  async reLoginWithCaptcha(yzm) {
    this.markLoggedOut();
    const { username, password } = this.reloadCredentials();
    return this.login({ username, password, yzm, force: true });
  }

  isExpiredResponse(res) {
    if (!res) return false;
    if (res.status >= 300 && res.status < 400 && /login_slogin/.test(res.location || '')) return true;
    if (/text\/html/i.test(res.contentType || '') && hasLoginForm(res.text || '')) return true;
    return false;
  }

  async ensureValid({ force = false } = {}) {
    const maxAge = this.config.session?.probeMaxAgeMs ?? 60000;
    if (!force && this.loggedIn && Date.now() - this.lastCheck < maxAge) return true;

    try {
      const res = await this.raw({ url: this.abs(this.config.session.probePath), method: 'GET', priority: 5 });
      if (this.isExpiredResponse(res)) {
        await this.reLogin();
      } else {
        this.loggedIn = true;
        this.lastCheck = Date.now();
      }
      return true;
    } catch (err) {
      if (err instanceof AuthError) throw err;
      logger.warn('会话探测失败，尝试重登', err.message);
      await this.reLogin();
      return true;
    }
  }

  async request(opts) {
    await this.ensureValid();
    let res = await this.raw(opts);
    if (this.isExpiredResponse(res)) {
      await this.reLogin();
      res = await this.raw(opts);
      if (this.isExpiredResponse(res)) throw new SessionExpiredError('重登后仍返回登录页');
    }
    return res;
  }

  status() {
    return {
      loggedIn: this.loggedIn,
      lastCheck: this.lastCheck,
      lastCheckAgo: this.lastCheck ? Date.now() - this.lastCheck : null,
      cookies: this.jar.names(),
      hasJSession: this.jar.has('JSESSIONID'),
      hasRoute: this.jar.has('route'),
      stats: this.stats,
      limiter: this.limiter.stats(),
      username: this.credentials?.username || '',
    };
  }
}

export { isLoginPage };
