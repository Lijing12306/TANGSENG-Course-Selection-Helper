import { callAction, callPage, baseParams } from './api.js';
import { extractOptions } from '../auth/html-extract.js';
import { logger } from '../core/logger.js';
import { classify } from './result-parser.js';
import { store } from '../core/config.js';

export async function resolveTerm(session, { force = false } = {}) {
  const config = store.config;
  if (!force && config.term?.xnm && config.term?.xqm) return config.term;
  try {
    const { text } = await callPage(session, 'xkIndex');
    const xnms = extractOptions(text, 'xnm');
    const xqms = extractOptions(text, 'xqm');
    const pick = (arr) => {
      const selected = arr.find((o) => /selected/i.test(o.label)) || arr.find((o) => o.value);
      return selected ? selected.value : '';
    };
    const xnm = pick(xnms);
    const xqm = pick(xqms);
    if (xnm || xqm) {
      store.saveConfig({ term: { xnm: xnm || config.term?.xnm || '', xqm: xqm || config.term?.xqm || '' } });
      logger.info('已从选课首页解析学期', { xnm, xqm });
      return { xnm, xqm };
    }
  } catch (err) {
    logger.debug('解析学期失败', err.message);
  }
  return config.term || { xnm: '', xqm: '' };
}

export async function queryCourses(session, { keyword = '', pageSize = 100, maxPages = 5, detail = true, detailMax = 30 } = {}) {
  const all = [];
  let total = 0;
  const step = pageSize;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await callAction(session, 'queryCourses', {
      keyword,
      pageNum: String(1 + (page - 1) * step),
      pageSize: String(page * step),
    });
    all.push(...res.list);
    total = res.total || all.length;
    if (res.list.length < step) break;
    if (total && all.length >= total) break;
  }
  if (!detail || all.length > detailMax) return { list: all, total: total || all.length };

  const rows = [];
  const seen = new Set();
  for (const c of all) {
    const ckey = String(c.courseId);
    if (seen.has(ckey)) continue;
    seen.add(ckey);
    let details = [];
    try {
      const d = await callAction(session, 'classDetail', { kchId: c.courseId, keyword });
      details = Array.isArray(d.list) ? d.list : [];
    } catch (err) {
      logger.debug('拉取教学班详情失败', c.courseId, err && err.message);
    }
    if (!details.length) {
      rows.push(c);
      continue;
    }
    for (const j of details) rows.push({ ...c, ...j, classId: j.classId || c.classId });
  }
  return { list: rows, total: rows.length };
}

export function filterCourses(list, { keyword = '', teacher = '', campus = '', onlyAvailable = false } = {}) {
  const kw = keyword.trim().toLowerCase();
  const tc = teacher.trim().toLowerCase();
  const cp = campus.trim().toLowerCase();
  return list.filter((c) => {
    if (kw) {
      const hay = `${c.courseName || ''} ${c.courseCode || ''} ${c.classCode || ''} ${c.teacher || ''}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (tc && !String(c.teacher || '').toLowerCase().includes(tc)) return false;
    if (cp && !String(c.campus || '').toLowerCase().includes(cp)) return false;
    if (onlyAvailable && Number(c.capacity) > 0 && Number(c.selected) >= Number(c.capacity)) return false;
    return true;
  });
}

export function capacityOf(course) {
  const selected = Number(course.selected);
  const capacity = Number(course.capacity);
  const hasFields = Number.isFinite(selected) && Number.isFinite(capacity) && capacity > 0;
  return {
    selected: Number.isFinite(selected) ? selected : null,
    capacity: Number.isFinite(capacity) ? capacity : null,
    available: hasFields ? Math.max(0, capacity - selected) : null,
    known: hasFields,
  };
}

export async function getSelected(session) {
  const res = await callAction(session, 'selectedList', {});
  return res;
}

export async function resolveSelectId(session, { courseId, classId }) {
  try {
    const d = await callAction(session, 'classDetail', { kchId: courseId });
    const hit = (d.list || []).find((x) => !classId || String(x.classId) === String(classId));
    if (hit && hit.doJxbId) return hit.doJxbId;
  } catch (err) {
    logger.debug('解析教学班加密id失败', err && err.message);
  }
  return classId;
}

export async function selectCourse(session, { jxbIds, kchId, resolve = true }) {
  const id = resolve ? await resolveSelectId(session, { courseId: kchId, classId: jxbIds }) : jxbIds;
  const res = await callAction(session, 'selectCourse', {
    jxbIds: Array.isArray(id) ? id.join(',') : id,
    kchId,
  });
  return { ...res, verdict: classify(res.raw) };
}

export async function dropCourse(session, { jxbIds, kchId, resolve = true }) {
  const id = resolve ? await resolveSelectId(session, { courseId: kchId, classId: jxbIds }) : jxbIds;
  const res = await callAction(session, 'dropCourse', {
    jxbIds: Array.isArray(id) ? id.join(',') : id,
    kchId,
  });
  return { ...res, verdict: classify(res.raw) };
}

export async function classDetail(session, { kchId, keyword = '' }) {
  return callAction(session, 'classDetail', { kchId, keyword });
}

export { baseParams };
