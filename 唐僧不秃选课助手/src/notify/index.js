import { EventEmitter } from 'node:events';
import { getConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import { sendLocal } from './local.js';
import { sendAllWebhooks } from './webhook.js';

export const EVENT_LABELS = {
  'login-ok': '登录成功',
  'login-fail': '登录失败',
  'captcha-required': '需要验证码',
  'session-lost': '会话失效',
  'course-available': '有名额',
  'select-success': '抢课成功',
  'select-fatal': '抢课失败（不可选）',
  'engine-paused': '引擎已暂停',
  'task-expired': '任务结束',
};

const DEFAULT_TITLES = {
  'select-success': '🎉 抢课成功',
  'select-fatal': '⛔ 抢课失败',
  'course-available': '👀 发现名额',
  'task-expired': '⏰ 任务结束',
  'login-fail': '🔒 登录失败',
  'captcha-required': '🤖 需要验证码',
  'session-lost': '🔁 会话失效',
  'engine-paused': '⏸ 引擎暂停',
  'login-ok': '✅ 登录成功',
};

export function buildMessage(event, payload = {}) {
  const title = DEFAULT_TITLES[event] || EVENT_LABELS[event] || event;
  const task = payload.task;
  const course = payload.course;
  const parts = [];
  if (task) parts.push(`任务：${task.name}`);
  if (course) {
    parts.push(`课程：${course.courseName || course.kcmc || ''}`);
    if (course.teacher) parts.push(`教师：${course.teacher}`);
    if (course.time) parts.push(`时间：${course.time}`);
  }
  if (payload.reason) parts.push(`原因：${payload.reason}`);
  if (payload.message) parts.push(payload.message);
  if (task?.lastMsg) parts.push(task.lastMsg);
  if (payload.recovered) parts.push('（崩溃恢复确认）');
  return { title, body: parts.filter(Boolean).join(' | ') || '无详细信息' };
}

class Notifier extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.recent = new Map();
    this.queue = [];
    this.draining = false;
  }

  matches(channel, event) {
    const events = channel.events || ['*'];
    return events.includes('*') || events.includes(event);
  }

  notify(event, payload = {}) {
    const cfg = getConfig();
    const windowMs = cfg?.notify?.dedupeWindowMs ?? 60000;
    const key = `${event}|${payload.task?.id || ''}|${payload.course?.classId || ''}`;
    const last = this.recent.get(key);
    if (last && Date.now() - last < windowMs) return;
    this.recent.set(key, Date.now());

    const { title, body } = buildMessage(event, payload);
    const msg = { ts: Date.now(), event, title, body, payload };

    this.emit('notify', msg);
    this.queue.push({ event, channelCfg: cfg?.notify?.channels || [], title, body });
    this._drain();
  }

  async _drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const { event, channelCfg, title, body } = this.queue.shift();
        try { await this._dispatch(event, channelCfg, title, body); }
        catch (err) { logger.debug('通知分发失败', err.message); }
      }
    } finally {
      this.draining = false;
    }
  }

  async _dispatch(event, channels, title, body) {
    const jobs = [];
    const webhookChannels = [];
    for (const ch of channels) {
      if (!ch.enabled) continue;
      if (!this.matches(ch, event)) continue;
      if (ch.type === 'browser') continue; // 已通过 emit('notify') 推送
      if (ch.type === 'local') {
        jobs.push(sendLocal({ title, body, toast: ch.toast !== false, sound: ch.sound !== false }));
      } else if (ch.type === 'webhook') {
        webhookChannels.push(ch);
      }
    }
    if (webhookChannels.length) {
      jobs.push(sendAllWebhooks(webhookChannels, { title, body }).then((rs) => {
        for (const r of rs) {
          if (!r.ok) logger.warn(`webhook(${r.provider}) 发送失败`, r.error || r.text || r.status);
        }
      }));
    }
    await Promise.allSettled(jobs);
  }

  async test() {
    const cfg = getConfig();
    const channels = (cfg?.notify?.channels || []).filter((c) => c.enabled);
    const out = [];
    for (const ch of channels) {
      if (ch.type === 'local') {
        const ok = await sendLocal({ title: '🔔 通知测试', body: '本地通知通道工作正常', toast: true, sound: true });
        out.push({ type: 'local', ok });
      } else if (ch.type === 'browser') {
        this.emit('notify', { ts: Date.now(), event: 'test', title: '🔔 通知测试', body: '浏览器通知通道工作正常', payload: {} });
        out.push({ type: 'browser', ok: true });
      } else if (ch.type === 'webhook') {
        const rs = await sendAllWebhooks([ch], { title: '🔔 通知测试', body: 'Webhook 通道工作正常' });
        out.push({ type: 'webhook', provider: ch.provider, ok: rs[0]?.ok || false, detail: rs[0] });
      }
    }
    if (!out.length) out.push({ type: 'none', ok: false, detail: '没有启用任何通知通道' });
    return out;
  }
}

export const notifier = new Notifier();
