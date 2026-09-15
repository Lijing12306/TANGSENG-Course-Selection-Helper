const TOKEN_KEY = 'zjgsu.tool.token';

export function getToken() {
  const url = new URL(location.href);
  const t = url.searchParams.get('token');
  if (t) { localStorage.setItem(TOKEN_KEY, t); return t; }
  return localStorage.getItem(TOKEN_KEY) || '';
}

async function req(method, path, body) {
  const headers = { 'X-Local-Token': getToken() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.code = data?.error;
    err.detail = data?.detail;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  status: () => req('GET', '/api/status'),
  login: (username, password, yzm) => req('POST', '/api/login', { username, password, yzm }),
  captcha: () => req('GET', '/api/captcha'),
  logout: () => req('POST', '/api/logout'),
  setCookie: (cookie) => req('POST', '/api/cookie', { cookie }),
  tasks: () => req('GET', '/api/tasks'),
  addTask: (t) => req('POST', '/api/tasks', t),
  updateTask: (id, t) => req('PUT', `/api/tasks/${id}`, t),
  removeTask: (id) => req('DELETE', `/api/tasks/${id}`),
  taskAction: (id, action) => req('POST', `/api/tasks/${id}/${action}`),
  engineStart: () => req('POST', '/api/engine/start'),
  engineStop: () => req('POST', '/api/engine/stop'),
  term: () => req('POST', '/api/term'),
  courses: (kw) => req('GET', `/api/courses?kw=${encodeURIComponent(kw || '')}`),
  selected: () => req('GET', '/api/selected'),
  select: (payload) => req('POST', '/api/select', payload),
  drop: (payload) => req('POST', '/api/drop', payload),
  logs: (limit = 200) => req('GET', `/api/logs?limit=${limit}`),
  snippet: () => req('GET', '/api/capture/snippet'),
  importCapture: (raw) => req('POST', '/api/capture/import', { raw }),
  applyCapture: (draft, merge = true) => req('POST', '/api/capture/apply', { draft, merge }),
  config: () => req('GET', '/api/config'),
  saveConfig: (patch) => req('PUT', '/api/config', patch),
  actions: () => req('GET', '/api/actions'),
  saveActions: (a) => req('PUT', '/api/actions', a),
  notifyTest: () => req('POST', '/api/notify/test'),
};

export function toast(msg, kind = '') {
  let box = document.querySelector('.toast');
  if (!box) { box = document.createElement('div'); box.className = 'toast'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
