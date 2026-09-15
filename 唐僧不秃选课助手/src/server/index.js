import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { PUBLIC_DIR, DATA_DIR, readJson } from '../core/storage.js';
import { store, getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { Engine } from '../engine/engine.js';
import { Session } from '../auth/session.js';
import { notifier } from '../notify/index.js';
import { SseHub } from './sse.js';
import { queryCourses, getSelected, selectCourse, dropCourse, resolveTerm } from '../zf/course.js';
import { parseCapture, diffAgainstCurrent, buildDraft, applyDraft } from '../capture/importer.js';
import { saveAccount, loadSecrets } from '../core/secrets.js';
import { AppError } from '../core/errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new AppError('请求体过大', 'BODY_TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ _raw: raw }); }
    });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

export async function startServer(session, config = getConfig()) {
  const engine = new Engine(session);
  engine.load();
  const sse = new SseHub();

  logger.on('log', (entry) => sse.send('log', entry));
  engine.on('task', (e) => sse.send('task', e));
  engine.on('state', (e) => sse.send('status', { engine: e }));
  notifier.on('notify', (msg) => sse.send('notify', msg));

  const token = crypto.randomBytes(16).toString('hex');

  const guard = (req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/' ) return true;
    if (url.pathname.startsWith('/assets/')) return true;
    const t = req.headers['x-local-token'] || url.searchParams.get('token');
    return t === token;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    const method = req.method.toUpperCase();

    try {
      if (p.startsWith('/api/')) {
        if (!guard(req)) return json(res, 401, { error: 'unauthorized', message: '本地令牌无效，请通过启动时输出的地址访问' });
        return await routeApi(req, res, { p, method, url, session, engine, sse, token });
      }
      return serveStatic(res, p);
    } catch (err) {
      const code = err instanceof AppError ? 400 : 500;
      logger.error(`API 错误 ${method} ${p}`, err.message);
      return json(res, code, { error: err.code || 'ERROR', message: err.message, detail: err.detail || null });
    }
  });

  const host = config.server?.host || '127.0.0.1';
  const port = config.server?.port || 8787;

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err && err.code === 'EADDRINUSE') {
        err.friendly = true;
        err.message =
          `端口 ${port} 已被占用，可能已经有一个「选课助手」在运行。\n` +
          `  · 如果程序已打开，请直接使用原来那个窗口/浏览器，无需再次启动；\n` +
          `  · 若要重新启动，请先关闭原来那个黑色窗口再试；\n` +
          `  · 或修改 config/config.json 里的 server.port（例如改成 8788）后重试。`;
      } else if (err && err.code === 'EACCES') {
        err.friendly = true;
        err.message = `没有权限监听端口 ${port}，请改用 1024 以上的端口。`;
      }
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, host, () => { server.removeListener('error', onError); resolve(); });
  });

  const addr = `http://${host}:${port}/?token=${token}`;
  process.stdout.write(`\n========================================\n`);
  process.stdout.write(`  选课助手控制台已启动\n`);
  process.stdout.write(`  ${addr}\n`);
  process.stdout.write(`  （仅本机可访问，令牌已用于鉴权）\n`);
  process.stdout.write(`========================================\n\n`);
  logger.info('Web 控制台已启动', { host, port });

  if (config.server?.openBrowser) openBrowser(addr);

  const shutdown = () => {
    logger.info('收到退出信号，正在停止…');
    engine.stop();
    engine.persist();
    session.jar.save();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { server, engine, sse, token };
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* ignore */ }
}

function serveStatic(res, p) {
  if (p === '/' || p === '/index.html') return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  return sendFile(res, file, true);
}

function sendFile(res, file, fallbackToIndex = false) {
  fs.readFile(file, (err, data) => {
    if (err) {
      if (fallbackToIndex) return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

async function routeApi(req, res, ctx) {
  const { p, method, session, engine, sse, token } = ctx;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};

  if (p === '/api/token') return json(res, 200, { ok: true, token });

  if (p === '/api/status' && method === 'GET') {
    return json(res, 200, {
      version: '1.0.0',
      calibrated: store.isCalibrated(),
      session: session.status(),
      engine: engine.status(),
      sseClients: sse.size(),
      now: Date.now(),
    });
  }

  if (p === '/api/events' && method === 'GET') {
    sse.add(res);
    sse.send('status', { engine: engine.status(), session: session.status() });
    return undefined;
  }

  if (p === '/api/login' && method === 'POST') {
    if (body.username && body.password && body.remember !== false) {
      saveAccount(body.username, body.password);
      store.saveConfig({ account: { username: body.username, password: '' } });
      session.reloadCredentials();
    }
    try {
      const r = await session.login({ force: true, username: body.username, password: body.password, yzm: body.yzm });
      notifier.notify('login-ok', { message: r.message });
      return json(res, 200, { ok: true, message: r.message, status: session.status() });
    } catch (err) {
      if (err.code === 'CAPTCHA_REQUIRED') {
        notifier.notify('captcha-required', { message: err.message });
        return json(res, 200, { ok: false, needCaptcha: true, captcha: err.captchaDataUrl, message: err.message });
      }
      if (err.code === 'CAS_REQUIRED') {
        return json(res, 200, { ok: false, needCas: true, message: err.message });
      }
      notifier.notify('login-fail', { message: err.message });
      return json(res, 400, { error: err.code || 'AUTH_ERROR', message: err.message, detail: err.detail || null });
    }
  }

  if (p === '/api/captcha' && method === 'GET') {
    const { fetchCaptcha } = await import('../auth/login.js');
    const c = await fetchCaptcha(session);
    return json(res, 200, { ok: !!c.dataUrl, captcha: c.dataUrl });
  }

  if (p === '/api/logout' && method === 'POST') {
    session.clear();
    return json(res, 200, { ok: true });
  }

  if (p === '/api/cookie' && method === 'POST') {
    const n = session.setManualCookie(body.cookie || '');
    return json(res, 200, { ok: n > 0, count: n });
  }

  if (p === '/api/tasks' && method === 'GET') return json(res, 200, { tasks: engine.list() });
  if (p === '/api/tasks' && method === 'POST') {
    const t = engine.addTask(body);
    return json(res, 200, { ok: true, task: t });
  }

  const taskMatch = p.match(/^\/api\/tasks\/([^/]+)(?:\/(\w+))?$/);
  if (taskMatch) {
    const id = taskMatch[1];
    const action = taskMatch[2];
    if (method === 'DELETE' && !action) { engine.removeTask(id); return json(res, 200, { ok: true }); }
    if (method === 'PUT' && !action) {
      const t = engine.updateTask(id, body);
      return json(res, 200, { ok: !!t, task: t });
    }
    if (method === 'POST' && action) {
      let t = null;
      if (action === 'start') t = engine.startTask(id);
      else if (action === 'pause') t = engine.pauseTask(id);
      else if (action === 'reset') t = engine.resetTask(id);
      else if (action === 'runOnce') t = await engine.runOnce(id);
      else return json(res, 400, { error: 'unknown action' });
      return json(res, 200, { ok: !!t, task: t });
    }
  }

  if (p === '/api/engine/start' && method === 'POST') { await engine.start(); return json(res, 200, { ok: true, engine: engine.status() }); }
  if (p === '/api/engine/stop' && method === 'POST') { engine.stop(); return json(res, 200, { ok: true, engine: engine.status() }); }

  if (p === '/api/term' && method === 'POST') {
    await session.ensureValid();
    const t = await resolveTerm(session, { force: true });
    return json(res, 200, { ok: true, term: t });
  }

  if (p === '/api/courses' && method === 'GET') {
    await session.ensureValid();
    await resolveTerm(session);
    const kw = ctx.url.searchParams.get('kw') || '';
    const pageSize = Number(ctx.url.searchParams.get('pageSize') || 100);
    const r = await queryCourses(session, { keyword: kw, pageSize });
    return json(res, 200, { ok: true, list: r.list, total: r.total });
  }

  if (p === '/api/selected' && method === 'GET') {
    await session.ensureValid();
    const r = await getSelected(session);
    return json(res, 200, { ok: true, list: r.list, raw: r.raw.slice(0, 2000) });
  }

  if (p === '/api/select' && method === 'POST') {
    await session.ensureValid();
    const r = await selectCourse(session, { jxbIds: body.jxbIds || body.jxbId, kchId: body.kchId });
    return json(res, 200, { ok: true, status: r.status, verdict: r.verdict, raw: String(r.raw).slice(0, 1000) });
  }

  if (p === '/api/drop' && method === 'POST') {
    await session.ensureValid();
    const r = await dropCourse(session, { jxbIds: body.jxbIds || body.jxbId, kchId: body.kchId });
    return json(res, 200, { ok: true, status: r.status, verdict: r.verdict, raw: String(r.raw).slice(0, 1000) });
  }

  if (p === '/api/logs' && method === 'GET') {
    const limit = Number(ctx.url.searchParams.get('limit') || 200);
    const level = ctx.url.searchParams.get('level');
    let logs = logger.recent(500);
    if (level) logs = logs.filter((l) => l.level === level);
    return json(res, 200, { ok: true, logs: logs.slice(-limit) });
  }

  if (p === '/api/capture/snippet' && method === 'GET') {
    const file = path.join(PUBLIC_DIR, 'assets', 'capture-snippet.js');
    return json(res, 200, { ok: true, snippet: fs.readFileSync(file, 'utf8') });
  }

  if (p === '/api/capture/import' && method === 'POST') {
    const parsed = parseCapture(body.raw || body._raw);
    const draft = buildDraft(parsed.entries);
    const diff = diffAgainstCurrent(draft);
    const summary = parsed.entries
      .map((e) => ({ method: e.method, path: e.path, tag: e.tag, status: e.status }))
      .filter((e) => e.path);
    return json(res, 200, { ok: true, draft, diff, summary, entries: parsed.entries.length });
  }

  if (p === '/api/capture/apply' && method === 'POST') {
    const draft = body.draft;
    if (!draft) return json(res, 400, { error: 'NO_DRAFT', message: '缺少 draft' });
    const next = applyDraft(draft, { merge: body.merge !== false });
    const backup = path.join(DATA_DIR, `actions.backup.${Date.now()}.json`);
    if (store.actions) fs.writeFileSync(backup, JSON.stringify(store.actions, null, 2));
    store.saveActions(next);
    return json(res, 200, { ok: true, calibrated: true, backup: path.basename(backup) });
  }

  if (p === '/api/config' && method === 'GET') {
    const cfg = JSON.parse(JSON.stringify(getConfig()));
    if (cfg.account?.password) cfg.account.password = '******';
    const secrets = loadSecrets();
    return json(res, 200, { ok: true, config: cfg, hasStoredPassword: !!secrets.password });
  }

  if (p === '/api/config' && method === 'PUT') {
    const patch = { ...body };
    if (patch.account?.password === '******') delete patch.account.password;
    const cfg = store.saveConfig(patch);
    if (cfg.account?.username) saveAccount(cfg.account.username, body.account?.password || session.credentials?.password || '');
    const fresh = JSON.parse(JSON.stringify(cfg));
    if (fresh.account?.password) fresh.account.password = '******';
    return json(res, 200, { ok: true, config: fresh });
  }

  if (p === '/api/actions' && method === 'GET') return json(res, 200, { ok: true, actions: store.actions });
  if (p === '/api/actions' && method === 'PUT') {
    store.saveActions(body);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/notify/test' && method === 'POST') {
    const results = await notifier.test();
    return json(res, 200, { ok: true, results });
  }

  return json(res, 404, { error: 'NOT_FOUND', message: `${method} ${p}` });
}
