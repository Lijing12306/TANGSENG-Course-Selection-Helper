import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import { NetworkError } from '../core/errors.js';

const agents = {
  https: new https.Agent({ keepAlive: true, maxSockets: 4, timeout: 30000 }),
  http: new http.Agent({ keepAlive: true, maxSockets: 4, timeout: 30000 }),
};

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function decompress(buffer, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('gzip')) return zlib.gunzipSync(buffer);
    if (enc.includes('deflate')) return zlib.inflateSync(buffer);
    if (enc.includes('br')) return zlib.brotliDecompressSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

export function buildAbsolute(baseUrl, target) {
  if (!target) return baseUrl;
  if (/^https?:\/\//i.test(target)) return target;
  return `${baseUrl.replace(/\/$/, '')}${target.startsWith('/') ? '' : '/'}${target}`;
}

export async function request({
  url,
  method = 'GET',
  headers = {},
  body = null,
  jar = null,
  timeout = 15000,
  retries = 0,
  retryDelayMs = 500,
  redirect = 'manual',
} = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      return await once({ url, method, headers, body, jar, timeout, redirect });
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (attempt > retries) break;
      await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }
  throw lastErr;
}

function once({ url, method, headers, body, jar, timeout, redirect }) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { return reject(new NetworkError(`非法 URL: ${url}`, err?.message)); }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const finalHeaders = {
      'User-Agent': DEFAULT_UA,
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      ...headers,
    };
    if (jar) {
      const cookie = jar.header(url, { secure: isHttps });
      if (cookie) finalHeaders.Cookie = cookie;
    }
    if (body != null && finalHeaders['Content-Length'] == null && finalHeaders['content-length'] == null) {
      finalHeaders['Content-Length'] = Buffer.byteLength(body);
    }

    let settled = false;
    const finish = (fn) => (arg) => { if (!settled) { settled = true; fn(arg); } };

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: method.toUpperCase(),
        headers: finalHeaders,
        agent: isHttps ? agents.https : agents.http,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', finish(() => {
          const raw = Buffer.concat(chunks);
          const buf = decompress(raw, res.headers['content-encoding']);
          const text = buf.toString('utf8');
          if (jar && Array.isArray(res.headers['set-cookie'])) jar.ingest(res.headers['set-cookie']);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            location: res.headers.location || null,
            setCookie: res.headers['set-cookie'] || [],
            date: res.headers.date || null,
            text,
            buf,
            contentType: res.headers['content-type'] || '',
            url,
          });
        }));
      },
    );

    req.setTimeout(timeout, finish(() => {
      req.destroy(new NetworkError(`请求超时 ${timeout}ms: ${url}`));
    }));
    req.on('error', finish((err) => reject(err instanceof Error && err.code ? new NetworkError(err.message, err.code) : err)));

    if (body != null) req.write(body);
    req.end();
  });
}

export async function getJson(res) {
  try { return JSON.parse(res.text); } catch { return null; }
}

export function isLoginPage(res) {
  return /login_slogin\.html/.test(res.location || '') || /id=["']?yhm["']?/.test(res.text || '');
}
