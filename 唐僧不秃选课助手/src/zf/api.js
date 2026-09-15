import { getActions, getConfig, store } from '../core/config.js';
import { fill, fillObject } from '../http/template.js';
import { NotCalibratedError, AppError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { classify } from './result-parser.js';

const CALIBRATION_REQUIRED = new Set(['queryCourses', 'selectCourse', 'selectedList', 'dropCourse', 'classDetail']);

export function baseParams(session, extra = {}) {
  const config = getConfig();
  const actions = getActions();
  const vars = { ...(actions.vars || {}) };
  if (config.term?.xnm) vars.xnm = config.term.xnm;
  if (config.term?.xqm) vars.xqm = config.term.xqm;
  return {
    baseUrl: config.baseUrl,
    gnmkdm: actions.meta?.gnmkdm || 'N253512',
    t: Date.now(),
    pageNum: '1',
    pageSize: '100',
    keyword: '',
    ...vars,
    ...extra,
  };
}

export function resolveAction(name) {
  const actions = getActions();
  const action = actions.actions?.[name];
  if (!action) throw new AppError(`未知接口动作: ${name}`, 'UNKNOWN_ACTION');
  return action;
}

function parseList(parsed, action) {
  if (parsed == null) return { list: [], total: 0 };
  const listPath = action.parse?.listPath;
  if (listPath && typeof parsed === 'object') {
    const list = parsed[listPath];
    if (Array.isArray(list)) return { list, total: Number(parsed[action.parse?.totalPath] ?? list.length) };
  }
  if (Array.isArray(parsed)) return { list: parsed, total: parsed.length };
  return { list: [], total: 0 };
}

function mapFields(row, fieldMap) {
  if (!fieldMap) return row;
  const out = { ...row };
  for (const [alias, key] of Object.entries(fieldMap)) {
    if (row[key] !== undefined) out[alias] = row[key];
  }
  return out;
}

export async function callAction(session, name, params = {}, opts = {}) {
  const { strict = true, throwOnError = false, method: methodOverride } = opts;
  const action = resolveAction(name);

  if (CALIBRATION_REQUIRED.has(name) && !store.isCalibrated() && !opts.allowUncalibrated) {
    throw new NotCalibratedError(`动作 [${name}] 依赖未校准的选课接口`);
  }

  const all = baseParams(session, params);
  const ctx = { actionName: name, strict };

  const query = fillObject(action.query || {}, all, ctx);
  const url = new URL(session.abs(fill(action.path, all, ctx)));
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    url.searchParams.set(k, String(v));
  }
  if ((action.queryParams || []).length) {
    for (const p of action.queryParams) url.searchParams.set(p, String(all[p] ?? ''));
  }
  const cfg = getConfig();
  if (cfg.engine && (getActions().defaults?.withTimeParam !== false)) {
    if (!url.searchParams.has('time')) url.searchParams.set('time', String(Date.now()));
  }

  let body = null;
  const contentType = action.contentType || 'none';
  if (['POST', 'PUT', 'PATCH'].includes(String(action.method).toUpperCase()) && contentType !== 'none') {
    const filled = { ...fillObject(action.body || {}, all, ctx), ...(action.extraBody || {}) };
    for (const [k, v] of Object.entries(filled)) {
      if (v === undefined) delete filled[k];
    }
    body = contentType === 'form'
      ? new URLSearchParams(filled).toString()
      : JSON.stringify(filled);
  }

  const headers = {
    ...(getActions().defaults?.headers || {}),
    ...(action.headers || {}),
  };
  if (contentType === 'form') headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  if (contentType === 'json') headers['Content-Type'] = 'application/json;charset=UTF-8';
  const refererTpl = action.referer || getActions().defaults?.referer;
  if (refererTpl) {
    try { headers.Referer = fill(refererTpl, all, { actionName: name, strict: false }); }
    catch { /* ignore */ }
  }

  const start = Date.now();
  const res = await session.request({
    url: url.toString(),
    method: (methodOverride || action.method || 'GET').toUpperCase(),
    headers,
    body,
    timeout: action.timeoutMs || getActions().defaults?.timeoutMs || 15000,
    priority: opts.priority ?? 0,
  });
  const ms = Date.now() - start;

  const responseType = action.responseType || 'auto';
  let parsed = null;
  if (responseType === 'json' || responseType === 'auto') {
    try { parsed = JSON.parse(res.text); } catch { parsed = null; }
  }
  const { list, total } = parseList(parsed, action);
  const mapped = list.map((row) => mapFields(row, action.fieldMap));
  const verdict = responseType === 'auto' ? classify(res.text) : classify(res.text);

  logger.debug(`[${name}] ${res.status} ${ms}ms`, { url: url.pathname, verdict: verdict.id });

  const result = {
    name,
    status: res.status,
    ms,
    url: url.toString(),
    headers: res.headers,
    raw: res.text,
    parsed,
    list: mapped,
    total,
    verdict,
  };

  if (throwOnError && !res.status.toString().startsWith('2')) {
    throw new AppError(`[${name}] HTTP ${res.status}`, 'HTTP_STATUS', { url: url.toString() });
  }
  return result;
}

export async function callPage(session, pageName) {
  const actions = getActions();
  const page = actions.pages?.[pageName];
  if (!page) throw new AppError(`未知页面: ${pageName}`, 'UNKNOWN_PAGE');
  const all = baseParams(session);
  const query = fillObject(page.query || {}, all, { actionName: pageName, strict: false });
  const url = new URL(session.abs(fill(page.path, all, { actionName: pageName, strict: false })));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v ?? ''));
  const res = await session.request({ url: url.toString(), method: page.method || 'GET' });
  return { res, text: res.text };
}
