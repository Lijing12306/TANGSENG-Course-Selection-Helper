import { getActions } from '../core/config.js';

const ACTION_BY_PATH = [
  { re: /zzxkyzb_cxZzxkYzb(?:Part)?Display/i, name: 'queryCourses' },
  { re: /zzxkyzb_xkBcZyZzxkYzb|zzxkyzb_xzYzbKc/i, name: 'selectCourse' },
  { re: /zzxkyzb_cxXkYzb/i, name: 'selectedList' },
  { re: /zzxkyzb_tkYzbKc/i, name: 'dropCourse' },
  { re: /zzxkyzb_cxJxbWithKchZzxkYzb|zzxkyzb_cxJxbzlb/i, name: 'classDetail' },
  { re: /zzxkyzb_cxZzxkYzbIndex/i, name: 'xkIndex' },
];

const IGNORE_QUERY = new Set(['time', 't', '_']);

export function guessActionName(path) {
  for (const item of ACTION_BY_PATH) if (item.re.test(path)) return item.name;
  return null;
}

export function parseCurl(text) {
  const src = String(text).replace(/\^\r?\n/g, ' ').replace(/\\\r?\n/g, ' ').trim();
  const urlMatch = src.match(/curl\s+(?:-X\s+\w+\s+)?(?:'([^']+)'|"([^"]+)")/);
  if (!urlMatch) return null;
  const url = urlMatch[1] || urlMatch[2];
  const methodMatch = src.match(/-X\s+([A-Za-z]+)/);
  let method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';
  const headers = {};
  const headerRe = /-H\s+(?:'([^']*)'|"([^"]*)")/g;
  let h;
  while ((h = headerRe.exec(src))) {
    const line = h[1] || h[2];
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const dataRe = /--data(?:-raw|-binary|-urlencode)?\s+(?:'([^']*)'|"([^"]*)")/;
  const dm = src.match(dataRe);
  const bodyRaw = dm ? (dm[1] !== undefined ? dm[1] : dm[2]) : null;
  if (bodyRaw && !methodMatch) method = 'POST';

  const u = new URL(url);
  const query = {};
  u.searchParams.forEach((v, k) => { query[k] = v; });
  const bodyForm = {};
  if (bodyRaw) {
    try { new URLSearchParams(bodyRaw).forEach((v, k) => { bodyForm[k] = v; }); } catch { /* ignore */ }
  }
  return {
    kind: 'curl', id: 1, tag: 'curl', method, url,
    origin: u.origin, path: u.pathname, query, headers, bodyRaw, bodyForm, status: null,
  };
}

export function parseCapture(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('输入为空');
  if (text.startsWith('{') || text.startsWith('[')) {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return { page: null, entries: json };
    if (json.entries) return { page: json.page || null, entries: json.entries };
    if (json.url) return { page: null, entries: [json] };
    throw new Error('无法识别的 JSON 结构');
  }
  if (/^curl\b/i.test(text)) {
    const e = parseCurl(text);
    if (!e) throw new Error('cURL 解析失败');
    return { page: null, entries: [e] };
  }
  throw new Error('无法识别输入格式：请粘贴抓包 JSON 或 Copy as cURL 内容');
}

function inferPlaceholder(key, value) {
  const k = key.toLowerCase();
  if (/^jxb_?ids?$/.test(k)) return '{jxbIds}';
  if (/^kch_?id$/.test(k)) return '{kchId}';
  if (/^jxb_?id$/.test(k)) return '{jxbId}';
  if (/^(k?xnm|xkxnm|xnm)$/.test(k) && /^\d{4}$/.test(value)) return '{xnm}';
  if (/^(k?xqm|xkxqm|xqm)$/.test(k)) return '{xqm}';
  if (/^page(num|index)$/.test(k)) return '{pageNum}';
  if (/^page(_?size|count)$/.test(k)) return '{pageSize}';
  if (/^(kcmc|keyword|search)$/.test(k)) return '{keyword}';
  if (/^gnmkdm$/.test(k)) return '{gnmkdm}';
  if (/^(time|_)$/.test(k)) return null;
  return value;
}

function buildBody(bodyForm, existingBody) {
  const body = {};
  const extra = {};
  for (const [k, v] of Object.entries(bodyForm || {})) {
    const ph = inferPlaceholder(k, v);
    if (ph === null) continue;
    const keepLiteral = typeof ph === 'string' && ph.startsWith('{');
    if (keepLiteral || existingBody?.[k] !== undefined) body[k] = ph;
    else body[k] = ph;
  }
  return { body, extra };
}

export function buildDraft(entries) {
  const grouped = {};
  for (const e of entries) {
    const name = guessActionName(e.path || e.url || '');
    if (!name) continue;
    grouped[name] = e;
  }
  const actions = {};
  for (const [name, e] of Object.entries(grouped)) {
    const isIndex = name === 'xkIndex';
    const query = {};
    for (const [k, v] of Object.entries(e.query || {})) {
      if (IGNORE_QUERY.has(k)) continue;
      query[k] = k === 'gnmkdm' ? '{gnmkdm}' : v;
    }
    const draft = { label: name, method: e.method || 'GET', path: e.path };
    if (Object.keys(query).length) draft.query = query;
    if (!isIndex) {
      draft.contentType = /json/i.test(e.headers?.['Content-Type'] || '') ? 'json' : 'form';
      const { body } = buildBody(e.bodyForm, null);
      if (Object.keys(body).length) draft.body = body;
      draft.responseType = /^\s*[[{]/.test(String(e.responseSnippet || '')) ? 'json' : 'auto';
    } else {
      draft.contentType = 'none';
    }
    actions[name] = draft;
  }
  return actions;
}

export function diffAgainstCurrent(draft) {
  const current = getActions();
  const cur = current?.actions || {};
  const lines = [];
  for (const [name, d] of Object.entries(draft)) {
    const c = cur[name];
    lines.push(`【${name}】`);
    if (!c) {
      lines.push(`  + 新增动作（当前配置中不存在）`);
      lines.push(`    路径: ${d.path}`);
      continue;
    }
    if (c.path !== d.path) lines.push(`  ! 路径差异: 期望 ${c.path}  实际 ${d.path}`);
    else lines.push(`  = 路径一致: ${d.path}`);

    const cBody = c.body || {};
    const dBody = d.body || {};
    const added = Object.keys(dBody).filter((k) => !(k in cBody));
    const missing = Object.keys(cBody).filter((k) => !(k in dBody));
    if (added.length) lines.push(`  + 需补充参数: ${added.join(', ')}`);
    if (missing.length) lines.push(`  - 配置多余参数: ${missing.join(', ')}`);
    const changed = Object.keys(dBody).filter((k) => k in cBody && String(cBody[k]) !== String(dBody[k]));
    for (const k of changed) {
      lines.push(`  ~ 参数取值差异: ${k}  配置=${JSON.stringify(cBody[k])}  实际=${JSON.stringify(dBody[k])}`);
    }
    const cQuery = Object.keys(c.query || {});
    const dQuery = Object.keys(d.query || {});
    const qAdded = dQuery.filter((k) => !cQuery.includes(k));
    if (qAdded.length) lines.push(`  + 需补充 query: ${qAdded.join(', ')}`);
    if (!added.length && !missing.length && !changed.length && !qAdded.length && c.path === d.path) {
      lines.push(`  ✅ 完全一致`);
    }
  }
  return lines.join('\n');
}

export function applyDraft(draft, { merge = true } = {}) {
  const current = getActions();
  const next = JSON.parse(JSON.stringify(current));
  next.actions = next.actions || {};
  for (const [name, d] of Object.entries(draft)) {
    const prev = next.actions[name];
    if (merge && prev) {
      next.actions[name] = {
        ...prev,
        ...d,
        body: { ...(prev.body || {}), ...(d.body || {}) },
        query: { ...(prev.query || {}), ...(d.query || {}) },
        fieldMap: prev.fieldMap || d.fieldMap,
        parse: prev.parse || d.parse,
      };
    } else {
      next.actions[name] = { ...prev, ...d };
    }
  }
  next.calibrated = true;
  next.meta = { ...(next.meta || {}), capturedAt: new Date().toISOString() };
  return next;
}
