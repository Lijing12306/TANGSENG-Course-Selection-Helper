import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA_DIR, ensureDir } from './storage.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEYS = /^(mm|password|passwd|pwd|cookie|set-cookie|token|authorization|csrftoken|sendkey|webhookkey|accesstoken|secret)$/i;

export function redact(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') {
    if (/^(?:[A-Za-z0-9+/]{40,}={0,2})$/.test(value)) return `***(${value.length})`;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '***' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function fmtArg(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try { return JSON.stringify(redact(a)); } catch { return String(a); }
}

class Logger extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.level = 'info';
    this.dir = path.join(DATA_DIR, 'logs');
    this.buffer = [];
    this.maxBuffer = 500;
  }

  configure({ level, dir } = {}) {
    if (level && LEVELS[level]) this.level = level;
    if (dir) this.dir = path.isAbsolute(dir) ? dir : path.join(DATA_DIR, '..', dir);
    return this;
  }

  _write(level, args) {
    const msg = args.map(fmtArg).join(' ');
    const entry = { ts: Date.now(), time: new Date().toISOString(), level, msg };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();

    if (LEVELS[level] >= LEVELS[this.level]) {
      const tag = `[${entry.time.slice(11, 19)}] ${level.toUpperCase().padEnd(5)}`;
      const stream = level === 'error' ? process.stderr : process.stdout;
      stream.write(`${tag} ${msg}\n`);
    }

    try {
      ensureDir(this.dir);
      const day = entry.time.slice(0, 10);
      fs.appendFileSync(path.join(this.dir, `${day}.log`), `${entry.time} ${level.toUpperCase()} ${msg}\n`, 'utf8');
    } catch { /* 日志写盘失败不影响主流程 */ }

    this.emit('log', entry);
  }

  debug(...a) { this._write('debug', a); }
  info(...a) { this._write('info', a); }
  warn(...a) { this._write('warn', a); }
  error(...a) { this._write('error', a); }

  recent(limit = 200) { return this.buffer.slice(-limit); }
}

export const logger = new Logger();
