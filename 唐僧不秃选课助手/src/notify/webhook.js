import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

function post(urlStr, body, contentType) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (err) { return reject(err); }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(payload) },
      timeout: 8000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('webhook 超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const PROVIDERS = {
  pushplus: (ch) => ({
    url: 'http://www.pushplus.plus/send',
    contentType: 'application/json',
    body: { token: ch.token, title: ch.title, content: ch.body, template: 'txt' },
  }),
  serverchan: (ch) => ({
    url: `https://sctapi.ftqq.com/${ch.sendKey}.send`,
    contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({ title: ch.title, desp: ch.body }).toString(),
  }),
  wecom: (ch) => ({
    url: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${ch.webhookKey}`,
    contentType: 'application/json',
    body: { msgtype: 'text', text: { content: `${ch.title}\n${ch.body}` } },
  }),
  dingtalk: (ch) => {
    let url = `https://oapi.dingtalk.com/robot/send?access_token=${ch.accessToken}`;
    if (ch.secret) {
      const ts = Date.now();
      const sign = crypto.createHmac('sha256', ch.secret).update(`${ts}\n${ch.secret}`).digest('base64');
      url += `&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
    }
    return { url, contentType: 'application/json', body: { msgtype: 'text', text: { content: `${ch.title}\n${ch.body}` } } };
  },
  bark: (ch) => ({
    url: `https://api.day.app/${ch.key}/${encodeURIComponent(ch.title)}/${encodeURIComponent(ch.body)}`,
    contentType: 'application/json',
    body: {},
  }),
  telegram: (ch) => ({
    url: `https://api.telegram.org/bot${ch.botToken}/sendMessage`,
    contentType: 'application/json',
    body: { chat_id: ch.chatId, text: `${ch.title}\n${ch.body}` },
  }),
};

export async function sendWebhook(channel, { title, body }) {
  const build = PROVIDERS[channel.provider];
  if (!build) throw new Error(`不支持的 webhook provider: ${channel.provider}`);
  const { url, contentType, body: payload } = build({ ...channel, title, body });
  const res = await post(url, payload, contentType);
  const ok = res.status >= 200 && res.status < 300;
  const text = String(res.text || '');
  const apiOk = ok && !/"errcode"\s*:\s*(?!0)\d+/.test(text) && !/"code"\s*:\s*(?!200|0)\d+/.test(text);
  return { ok: apiOk, status: res.status, text: text.slice(0, 200) };
}

export async function sendAllWebhooks(channels, payload) {
  const results = [];
  for (const ch of channels) {
    try {
      const r = await sendWebhook(ch, payload);
      results.push({ provider: ch.provider, ...r });
    } catch (err) {
      results.push({ provider: ch.provider, ok: false, error: err.message });
    }
  }
  return results;
}
