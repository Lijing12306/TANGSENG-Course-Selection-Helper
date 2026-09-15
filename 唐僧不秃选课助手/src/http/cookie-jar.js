import { readJson, writeJsonAtomic } from '../core/storage.js';
import path from 'node:path';
import { DATA_DIR } from '../core/storage.js';

const COOKIE_FILE = path.join(DATA_DIR, 'cookies.json');

function normDomain(host) {
  return String(host || '').replace(/^\./, '').toLowerCase();
}

function domainMatch(cookieDomain, host) {
  if (!cookieDomain) return true;
  const h = normDomain(host);
  const d = normDomain(cookieDomain);
  return h === d || h.endsWith(`.${d}`);
}

export class CookieJar {
  constructor() {
    this.map = new Map();
    this.dirty = false;
  }

  static key(name, domain, pathv) {
    return `${name}|${normDomain(domain)}|${pathv || '/'}`;
  }

  ingest(headerValues = []) {
    for (const raw of headerValues) {
      if (!raw) continue;
      const parts = String(raw).split(';').map((s) => s.trim());
      const eq = parts[0].indexOf('=');
      if (eq < 0) continue;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1);
      const cookie = {
        name, value, domain: null, path: '/', expires: Infinity, secure: false, httpOnly: false,
      };
      for (const p of parts.slice(1)) {
        const i = p.indexOf('=');
        const k = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
        const v = i < 0 ? '' : p.slice(i + 1).trim();
        if (k === 'max-age') {
          const n = Number(v);
          if (Number.isFinite(n)) cookie.expires = Date.now() + n * 1000;
        } else if (k === 'expires') {
          const t = Date.parse(v);
          if (!Number.isNaN(t)) cookie.expires = t;
        } else if (k === 'domain') cookie.domain = normDomain(v);
        else if (k === 'path') cookie.path = v || '/';
        else if (k === 'secure') cookie.secure = true;
        else if (k === 'httponly') cookie.httpOnly = true;
      }
      const key = CookieJar.key(name, cookie.domain, cookie.path);
      if (cookie.expires <= Date.now()) this.map.delete(key);
      else this.map.set(key, cookie);
      this.dirty = true;
    }
    return this;
  }

  set(name, value, domain = null, pathv = '/') {
    this.map.set(CookieJar.key(name, domain, pathv), {
      name, value, domain: domain ? normDomain(domain) : null, path: pathv,
      expires: Infinity, secure: false, httpOnly: false,
    });
    this.dirty = true;
    return this;
  }

  header(url, { secure = true } = {}) {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* ignore */ }
    const now = Date.now();
    const out = [];
    for (const [k, c] of this.map) {
      if (c.expires <= now) { this.map.delete(k); this.dirty = true; continue; }
      if (!domainMatch(c.domain, host)) continue;
      if (c.secure && !secure) continue;
      out.push(`${c.name}=${c.value}`);
    }
    return out.join('; ');
  }

  get(name) {
    for (const c of this.map.values()) if (c.name === name) return c.value;
    return null;
  }

  has(name) { return this.get(name) != null; }

  clear() { this.map.clear(); this.dirty = true; }

  names() { return [...new Set([...this.map.values()].map((c) => c.name))]; }

  toJSON() { return [...this.map.values()]; }

  static fromJSON(arr) {
    const jar = new CookieJar();
    for (const c of arr || []) {
      if (!c || !c.name) continue;
      jar.map.set(CookieJar.key(c.name, c.domain, c.path), c);
    }
    return jar;
  }

  load() {
    const arr = readJson(COOKIE_FILE, []);
    for (const c of arr) {
      if (!c || !c.name) continue;
      this.map.set(CookieJar.key(c.name, c.domain, c.path), c);
    }
    return this;
  }

  save() {
    if (!this.dirty) return this;
    writeJsonAtomic(COOKIE_FILE, this.toJSON());
    this.dirty = false;
    return this;
  }
}
