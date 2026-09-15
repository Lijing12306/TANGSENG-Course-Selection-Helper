let seq = 0;

export const STATES = ['idle', 'running', 'paused', 'success', 'fatal', 'expired', 'recovering'];

export function createTask(input = {}) {
  seq += 1;
  const now = Date.now();
  return normalize({
    id: input.id || `t_${now}_${seq}`,
    name: input.name || '未命名任务',
    target: input.target || {},
    mode: input.mode || 'auto',
    startAt: input.startAt || null,
    endAt: input.endAt || null,
    intervalMs: input.intervalMs || null,
    burstIntervalMs: input.burstIntervalMs || null,
    burstWindowMs: input.burstWindowMs || null,
    maxAttempts: input.maxAttempts ?? 0,
    state: input.state || 'idle',
    stats: input.stats || {},
    lastMsg: input.lastMsg || '',
    lastErr: input.lastErr || '',
    createdAt: input.createdAt || now,
    updatedAt: now,
  });
}

function normalize(t) {
  t.target = t.target || {};
  if (typeof t.target.kcmcRegex === 'string' && t.target.kcmcRegex) {
    try { new RegExp(t.target.kcmcRegex); } catch { t.target.kcmcRegex = ''; }
  }
  t.target.jxbIds = Array.isArray(t.target.jxbIds) ? t.target.jxbIds : (t.target.jxbIds ? [t.target.jxbIds] : []);
  t.target.exclude = Array.isArray(t.target.exclude) ? t.target.exclude : [];
  t.stats = { polls: 0, submits: 0, confirmed: 0, lastPollAt: 0, ...t.stats };
  return t;
}

export function matchCourse(task, course) {
  const t = task.target || {};
  const hasClassCond = Boolean(t.jxbIds?.length);
  const hasCourseCond = Boolean(t.kchId || t.kcmcRegex || t.teacherRegex);

  if (hasClassCond) {
    const idx = t.jxbIds.findIndex((id) => String(id) === String(course.classId));
    if (idx >= 0) return { match: true, priority: 100 + (t.jxbIds.length - idx) };
    if (!hasCourseCond) return { match: false, reason: '教学班id不匹配' };
  }

  if (t.kchId && String(course.courseId) !== String(t.kchId)) return { match: false };
  if (t.kcmcRegex) {
    try { if (!new RegExp(t.kcmcRegex).test(String(course.courseName || ''))) return { match: false }; }
    catch { /* 忽略非法正则 */ }
  }
  if (t.teacherRegex) {
    try { if (!new RegExp(t.teacherRegex).test(String(course.teacher || ''))) return { match: false }; }
    catch { /* 忽略 */ }
  }
  for (const ex of t.exclude) {
    try { if (new RegExp(ex).test(String(course.courseName || ''))) return { match: false }; } catch { /* 忽略 */ }
  }
  if (!hasClassCond && !hasCourseCond) return { match: false, reason: '目标条件为空' };
  return { match: true, priority: 1 };
}

export function inWindow(task, now = Date.now()) {
  const startAt = task.startAt ? Date.parse(task.startAt) : null;
  const endAt = task.endAt ? Date.parse(task.endAt) : null;
  if (startAt && now < startAt) return { ok: false, reason: 'not-started', startAt };
  if (endAt && now > endAt) return { ok: false, reason: 'expired', endAt };
  return { ok: true, startAt, endAt };
}

export function describe(task) {
  const t = task.target || {};
  const bits = [];
  if (t.courseName) bits.push(t.courseName);
  if (t.kcmcRegex) bits.push(`/${t.kcmcRegex}/`);
  if (t.teacherRegex) bits.push(`教师/${t.teacherRegex}/`);
  if (t.jxbIds?.length) bits.push(`教学班×${t.jxbIds.length}`);
  return bits.join(' ') || '(无条件)';
}
