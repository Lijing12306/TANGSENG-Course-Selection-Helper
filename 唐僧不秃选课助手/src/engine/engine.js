import { EventEmitter } from 'node:events';
import path from 'node:path';
import { DATA_DIR, readJson, writeJsonAtomic, appendJsonl } from '../core/storage.js';
import { logger } from '../core/logger.js';
import { getConfig, store } from '../core/config.js';
import { createTask, matchCourse, inWindow, describe } from './task.js';
import { KeyedLock, Dedupe } from './locking.js';
import { queryCourses, selectCourse, getSelected, capacityOf, resolveTerm, classDetail } from '../zf/course.js';
import { isSuccess, isFatal } from '../zf/result-parser.js';
import { notifier } from '../notify/index.js';
import { NotCalibratedError } from '../core/errors.js';

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const EVENT_FILE = path.join(DATA_DIR, 'state.jsonl');

export class Engine extends EventEmitter {
  constructor(session) {
    super();
    this.session = session;
    this.tasks = new Map();
    this.timers = new Map();
    this.locks = new KeyedLock();
    this.dedupe = new Dedupe(getConfig()?.engine?.dedupeWindowMs ?? 10000);
    this.running = false;
    this.startedAt = 0;
  }

  // ---- 持久化 ----
  load() {
    const saved = readJson(STATE_FILE, { tasks: [] });
    for (const raw of saved.tasks || []) {
      const t = createTask(raw);
      if (t.state === 'running') t.state = 'recovering';
      this.tasks.set(t.id, t);
    }
    if (this.tasks.size) logger.info(`已载入 ${this.tasks.size} 个任务`);
  }

  persist() {
    writeJsonAtomic(STATE_FILE, {
      savedAt: Date.now(),
      tasks: [...this.tasks.values()],
    });
  }

  event(type, task, extra = {}) {
    const payload = { ts: Date.now(), type, taskId: task?.id, name: task?.name, ...extra };
    appendJsonl(EVENT_FILE, payload);
    this.emit('task', payload);
  }

  // ---- 任务管理 ----
  addTask(input) {
    const t = createTask(input);
    t.state = 'idle';
    this.tasks.set(t.id, t);
    this.persist();
    this.event('task-added', t);
    logger.info(`新建任务：${t.name} (${describe(t)})`);
    return t;
  }

  updateTask(id, patch) {
    const t = this.tasks.get(id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: Date.now() });
    if (patch.target) t.target = { ...t.target, ...patch.target };
    this.persist();
    this.event('task-updated', t);
    return t;
  }

  removeTask(id) {
    this._clearTimer(id);
    const t = this.tasks.get(id);
    this.tasks.delete(id);
    this.persist();
    this.event('task-removed', t);
    return true;
  }

  getTask(id) { return this.tasks.get(id); }
  list() { return [...this.tasks.values()]; }

  // ---- 生命周期 ----
  async start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();
    logger.info('引擎已启动');
    this.emit('state', this.status());

    await this.recover();

    for (const t of this.tasks.values()) {
      if (['running', 'idle', 'recovering'].includes(t.state)) this.startTask(t.id);
    }
  }

  stop() {
    this.running = false;
    for (const id of this.timers.keys()) this._clearTimer(id);
    logger.info('引擎已停止');
    this.emit('state', this.status());
  }

  async recover() {
    const pending = [...this.tasks.values()].filter((t) => t.state === 'recovering' || t.state === 'running');
    if (!pending.length) return;
    logger.info(`崩溃恢复：检查 ${pending.length} 个任务是否已选上`);

    let selected = [];
    try {
      await this.session.ensureValid();
      await resolveTerm(this.session);
      if (store.isCalibrated()) {
        const res = await getSelected(this.session);
        selected = res.list || [];
      } else {
        logger.warn('接口未校准，跳过已选确认，直接续跑');
      }
    } catch (err) {
      logger.warn('恢复查询失败，将直接续跑', err.message);
    }

    const selectedIds = new Set(selected.map((c) => String(c.classId)));
    for (const t of pending) {
      const hit = (t.target.jxbIds || []).some((id) => selectedIds.has(String(id)));
      if (hit) {
        t.state = 'success';
        t.stats.confirmed += 1;
        t.lastMsg = '崩溃恢复时确认已选上';
        this.event('select-success', t, { recovered: true });
        notifier.notify('select-success', { task: t, recovered: true });
      } else {
        t.state = 'idle';
        logger.info(`恢复：${t.name} 未选上，继续监控`);
      }
      t.updatedAt = Date.now();
    }
    this.persist();
  }

  startTask(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    if (t.state === 'success' || t.state === 'fatal') {
      logger.warn(`任务 ${t.name} 已结束(${t.state})，如需重跑请先重置`);
      return t;
    }
    t.state = 'running';
    t.updatedAt = Date.now();
    this.persist();
    this.event('task-started', t);
    this._schedule(t, 200);
    return t;
  }

  pauseTask(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    this._clearTimer(id);
    t.state = 'paused';
    t.updatedAt = Date.now();
    this.persist();
    this.event('task-paused', t);
    return t;
  }

  resetTask(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    this._clearTimer(id);
    t.state = 'idle';
    t.stats = { polls: 0, submits: 0, confirmed: 0, lastPollAt: 0 };
    t.lastErr = '';
    t.lastMsg = '';
    t.updatedAt = Date.now();
    this.dedupe.reset();
    this.persist();
    this.event('task-reset', t);
    return t;
  }

  async runOnce(id) {
    const t = this.tasks.get(id);
    if (!t) return null;
    const restore = t.state;
    t.state = 'running';
    try { await this._tick(t, { force: true }); } finally {
      if (t.state === 'running') t.state = restore === 'paused' ? 'paused' : 'idle';
      this.persist();
    }
    return t;
  }

  // ---- 调度 ----
  _clearTimer(id) {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
  }

  _schedule(t, delayMs = null) {
    if (!this.running || t.state !== 'running') return;
    const e = getConfig().engine;
    const base = t.intervalMs || e.defaultIntervalMs || 3000;
    let delay = delayMs ?? base;
    delay *= 0.85 + Math.random() * 0.3; // ±15% 抖动
    this._clearTimer(t.id);
    const timer = setTimeout(() => {
      this.timers.delete(t.id);
      this._tick(t).catch((err) => logger.error(`任务 ${t.name} 执行异常`, err));
    }, Math.max(50, delay));
    this.timers.set(t.id, timer);
  }

  _intervalFor(t, now) {
    const e = getConfig().engine;
    const burstLead = e.burstLeadMs ?? 15000;
    const startAt = t.startAt ? Date.parse(t.startAt) : null;
    if (!startAt) return { interval: t.intervalMs || e.defaultIntervalMs, burst: false };
    const delta = startAt - now;
    if (delta > burstLead) return { interval: t.intervalMs || e.defaultIntervalMs, burst: false };
    if (delta > 0) return { interval: 1000, burst: false };
    const burstWindow = t.burstWindowMs || e.defaultBurstWindowMs || 15000;
    if (now - startAt < burstWindow) {
      return { interval: t.burstIntervalMs || e.defaultBurstIntervalMs || 700, burst: true };
    }
    return { interval: t.intervalMs || e.defaultIntervalMs, burst: false };
  }

  async _tick(t, { force = false } = {}) {
    if (!force && (t.state !== 'running' || !this.running)) return;
    const e = getConfig().engine;
    const now = Date.now();
    const w = inWindow(t, now);

    if (!w.ok) {
      if (w.reason === 'expired') {
        t.state = 'expired';
        t.lastMsg = '已超过结束时间';
        this.persist();
        this.event('task-expired', t);
        notifier.notify('task-expired', { task: t });
        return;
      }
      t.lastMsg = '未到开始时间，等待中';
      this.persist();
      this._schedule(t, Math.min(t.intervalMs || 5000, 5000));
      return;
    }

    const plan = this._intervalFor(t, now);
    if (plan.burst) this.session.limiter.enterBurst(plan.interval * 3);

    if (t.maxAttempts && t.stats.polls >= t.maxAttempts) {
      t.state = 'expired';
      t.lastMsg = `已达到最大轮询次数 ${t.maxAttempts}`;
      this.persist();
      this.event('task-expired', t, { reason: 'maxAttempts' });
      notifier.notify('task-expired', { task: t, reason: '轮询次数用尽' });
      return;
    }

    let nextDelay = plan.interval;
    try {
      const keyword = t.target.keyword || t.target.courseName || '';
      const { list } = await queryCourses(this.session, { keyword, maxPages: 1, detail: false });
      t.stats.polls += 1;
      t.stats.lastPollAt = Date.now();

      const matched = [];
      for (const c of list) {
        const m = matchCourse(t, c);
        if (m.match) matched.push({ course: c, priority: m.priority });
      }
      matched.sort((a, b) => b.priority - a.priority);

      if (!matched.length) {
        t.lastMsg = `第 ${t.stats.polls} 次轮询：未匹配到目标课程（返回 ${list.length} 条）`;
        logger.debug(t.lastMsg);
      } else {
        let acted = false;
        const wanted = t.target.jxbIds || [];
        for (const { course: base } of matched) {
          let items = [base];
          try {
            const d = await classDetail(this.session, { kchId: base.courseId });
            const details = Array.isArray(d.list) ? d.list : [];
            if (details.length) {
              const picked = wanted.length
                ? details.filter((x) => wanted.some((id) => String(id) === String(x.classId)))
                : [];
              items = (picked.length ? picked : details).map((x) => ({ ...base, ...x }));
            }
          } catch (err) {
            logger.debug('取教学班详情失败', err && err.message);
          }

          for (const course of items) {
            const cap = capacityOf(course);
            const fallback = e.capacityUnknownFallback || 'always-try';
            const mayTry = cap.known ? cap.available > 0 : fallback === 'always-try';

            if (t.mode === 'watch') {
              t.lastMsg = `监控中：${course.courseName} 余量 ${cap.known ? cap.available : '未知'}`;
              if (cap.known && cap.available > 0) notifier.notify('course-available', { task: t, course });
              continue;
            }

            if (!mayTry) {
              t.lastMsg = `第 ${t.stats.polls} 次轮询：${course.courseName} 已满（${cap.selected}/${cap.capacity}）`;
              continue;
            }

            await this._tryGrab(t, course, cap);
            acted = true;
            if (isSuccess(t._lastVerdict || {}) || isFatal(t._lastVerdict || {})) break;
          }
          if (isSuccess(t._lastVerdict || {}) || isFatal(t._lastVerdict || {})) break;
        }
        if (!acted && !t.lastMsg) t.lastMsg = `第 ${t.stats.polls} 次轮询：无可用名额`;
      }
    } catch (err) {
      if (err instanceof NotCalibratedError) {
        t.state = 'paused';
        t.lastErr = err.message;
        this.persist();
        logger.warn(`任务 ${t.name} 已暂停：${err.message}`);
        this.event('task-paused', t, { reason: 'not-calibrated' });
        return;
      }
      if (err.code === 'CAPTCHA_REQUIRED' || err.code === 'CAS_REQUIRED') {
        for (const task of this.tasks.values()) {
          if (task.state === 'running') { task.state = 'paused'; task.lastErr = err.message; }
        }
        this.persist();
        this.stop();
        logger.error(`自动重登被阻断：${err.message}。请到控制台完成验证码登录后重新启动引擎。`);
        this.event('engine-paused', t, { reason: err.code });
        notifier.notify('captcha-required', { task: t, message: err.message });
        return;
      }
      t.lastErr = err.message;
      logger.warn(`任务 ${t.name} 轮询失败: ${err.message}`);
      if (/频繁|繁忙|429/.test(err.message)) {
        nextDelay = e.busyCooldownMs || 60000;
        this.session.limiter.slowDown(nextDelay);
      } else {
        nextDelay = Math.max(plan.interval, 2000);
      }
    }

    t.updatedAt = Date.now();
    this.persist();
    this.emit('task', { ts: Date.now(), type: 'task-tick', taskId: t.id });
    this._schedule(t, nextDelay);
  }

  async _tryGrab(t, course, cap) {
    const e = getConfig().engine;
    const jxbId = course.classId;
    const key = `${t.id}|${jxbId}`;

    if (!this.dedupe.check(key)) {
      t.lastMsg = `${course.courseName} 已在去重窗口内提交过，跳过`;
      return;
    }

    await this.locks.run(jxbId, async () => {
      if (e.dryRun) {
        t.stats.submits += 1;
        t.lastMsg = `[试运行] 命中 ${course.courseName}，本应提交选课 jxb_id=${jxbId}`;
        logger.info(t.lastMsg);
        return;
      }

      t.lastMsg = `命中 ${course.courseName}（余量 ${cap.known ? cap.available : '未知'}），提交选课…`;
      logger.info(`任务 ${t.name}：${t.lastMsg}`);
      appendJsonl(EVENT_FILE, { ts: Date.now(), type: 'submit-sent', taskId: t.id, jxbId });

      const res = await selectCourse(this.session, { jxbIds: course.doJxbId || jxbId, kchId: course.courseId, resolve: false });
      t.stats.submits += 1;
      t._lastVerdict = res.verdict;

      const snippet = String(res.raw || '').slice(0, 300);
      if (isSuccess(res.verdict)) {
        t.state = 'success';
        t.lastMsg = `选课成功：${course.courseName}（${res.verdict.id}）`;
        logger.info(`✅ ${t.name} ${t.lastMsg}`);
        this.event('select-success', t, { course, verdict: res.verdict });
        notifier.notify('select-success', { task: t, course });
        await this._confirm(t, jxbId);
      } else if (isFatal(res.verdict)) {
        t.state = 'fatal';
        t.lastErr = `不可选：${res.verdict.id} ${snippet}`;
        t.lastMsg = `失败：${res.verdict.id}`;
        logger.warn(`⛔ ${t.name} ${t.lastErr}`);
        this.event('select-fatal', t, { course, verdict: res.verdict, snippet });
        notifier.notify('select-fatal', { task: t, course, reason: res.verdict.id });
      } else if (res.verdict.type === 'cooldown' || res.verdict.type === 'cooldownTime') {
        const cd = res.verdict.cooldownMs || 60000;
        t.lastMsg = `冷却 ${Math.round(cd / 1000)}s（${res.verdict.id}）`;
        if (res.verdict.id === 'busy') this.session.limiter.slowDown(cd);
        this.dedupe.reset(key);
        await new Promise((r) => setTimeout(r, Math.min(cd, 3000)));
        this._schedule(t, cd);
      } else {
        t.lastMsg = `未成功（${res.verdict.id}）：${snippet}`;
        logger.warn(`任务 ${t.name} ${t.lastMsg}`);
        this.event('select-retry', t, { course, verdict: res.verdict, snippet });
        if (res.verdict.id === 'unknown') {
          logger.warn(`[unknown 规则未命中] 原始响应：${snippet}`);
          this.event('unknown-response', t, { snippet, action: 'selectCourse' });
        }
      }
    });
  }

  async _confirm(t, jxbId) {
    if (!store.isCalibrated()) return;
    try {
      await new Promise((r) => setTimeout(r, 800));
      const res = await getSelected(this.session);
      const hit = (res.list || []).some((c) => String(c.classId) === String(jxbId));
      if (hit) {
        t.stats.confirmed += 1;
        t.lastMsg += '（已确认）';
      } else {
        t.lastMsg += '（未在已选列表找到，请手动核实）';
        logger.warn(`任务 ${t.name} 选课声称成功但未在已选列表确认`);
      }
      this.persist();
    } catch (err) {
      logger.debug('确认已选失败', err.message);
    }
  }

  status() {
    const list = this.list();
    return {
      running: this.running,
      startedAt: this.startedAt,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      tasks: list.length,
      counts: list.reduce((acc, t) => {
        acc[t.state] = (acc[t.state] || 0) + 1;
        return acc;
      }, {}),
      inflight: this.locks.size(),
      limiter: this.session.limiter.stats(),
    };
  }
}
