import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, readJson, writeJsonAtomic, copyIfMissing } from './storage.js';
import { ConfigError } from './errors.js';
import { logger } from './logger.js';

export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const ACTIONS_FILE = path.join(CONFIG_DIR, 'actions.json');
export const RULES_FILE = path.join(CONFIG_DIR, 'result-rules.json');

const DEFAULTS = {
  baseUrl: 'https://jwxt.zjgsu.edu.cn',
  server: { host: '127.0.0.1', port: 8787, openBrowser: true },
  account: { username: '', password: '' },
  session: {
    loginPath: '/jwglxt/xtgl/login_slogin.html',
    publicKeyPath: '/jwglxt/xtgl/login_getPublicKey.html',
    logoutAccountPath: '/jwglxt/xtgl/login_logoutAccount.html',
    captchaPath: '/jwglxt/kaptcha',
    probePath: '/jwglxt/xtgl/index_initMenu.html',
    probeMaxAgeMs: 60000,
    maxLoginAttempts: 3,
    preLoginLogout: true,
    clickIndexOnLogin: false,
    manualCookie: '',
  },
  term: { xnm: '', xqm: '' },
  engine: {
    requestsPerSecond: 1,
    burstRequestsPerSecond: 2,
    maxConcurrentRequests: 2,
    defaultIntervalMs: 3000,
    defaultBurstIntervalMs: 700,
    defaultBurstWindowMs: 15000,
    burstLeadMs: 15000,
    busyCooldownMs: 60000,
    dedupeWindowMs: 10000,
    capacityUnknownFallback: 'always-try',
    dryRun: false,
  },
  notify: { dedupeWindowMs: 60000, channels: [] },
  log: { level: 'info', dir: 'data/logs' },
};

function merge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override === undefined ? base : override;
  if (typeof base !== 'object' || base === null) return override === undefined ? base : override;
  if (typeof override !== 'object' || override === null) return base;
  const out = { ...base };
  for (const key of Object.keys(override)) out[key] = merge(base[key], override[key]);
  return out;
}

export function bootstrapConfigFiles() {
  const created = [];
  if (copyIfMissing(path.join(CONFIG_DIR, 'config.example.json'), CONFIG_FILE)) created.push('config.json');
  if (copyIfMissing(path.join(CONFIG_DIR, 'actions.example.json'), ACTIONS_FILE)) created.push('actions.json');
  if (copyIfMissing(path.join(CONFIG_DIR, 'result-rules.example.json'), RULES_FILE)) created.push('result-rules.json');
  return created;
}

class ConfigStore {
  constructor() {
    this.config = null;
    this.actions = null;
    this.rules = null;
    this.listeners = new Set();
  }

  load() {
    bootstrapConfigFiles();
    const raw = readJson(CONFIG_FILE, {});
    this.config = merge(DEFAULTS, raw);
    this.actions = readJson(ACTIONS_FILE, null);
    this.rules = readJson(RULES_FILE, { rules: [] })?.rules || [];
    if (!this.actions || !this.actions.actions) {
      throw new ConfigError('actions.json 缺失或格式不正确', { file: ACTIONS_FILE });
    }
    logger.configure(this.config.log);
    return this.config;
  }

  reloadActions() {
    this.actions = readJson(ACTIONS_FILE, this.actions);
    this.rules = readJson(RULES_FILE, { rules: this.rules }).rules || this.rules;
    this.emit();
    return this.actions;
  }

  saveConfig(patch) {
    const current = readJson(CONFIG_FILE, {});
    const next = merge(current, patch);
    writeJsonAtomic(CONFIG_FILE, next);
    this.config = merge(DEFAULTS, next);
    logger.configure(this.config.log);
    this.emit();
    return this.config;
  }

  saveActions(actions) {
    if (!actions || !actions.actions) throw new ConfigError('actions 结构不合法');
    writeJsonAtomic(ACTIONS_FILE, actions);
    this.actions = actions;
    this.emit();
    return actions;
  }

  setRules(rules) {
    writeJsonAtomic(RULES_FILE, { _readme: '选课结果判定规则（热重载生效）', rules });
    this.rules = rules;
    this.emit();
    return rules;
  }

  isCalibrated() {
    return Boolean(this.actions?.calibrated);
  }

  watch() {
    try {
      fs.watch(CONFIG_DIR, (_event, filename) => {
        if (!filename) return;
        if (filename === 'actions.json' || filename === 'result-rules.json') {
          setTimeout(() => {
            try { this.reloadActions(); logger.info('配置热重载成功', { filename }); }
            catch (err) { logger.warn('配置热重载失败，保持原配置', err); }
          }, 150);
        }
      });
    } catch { /* watch 不可用时忽略 */ }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch { /* ignore */ } } }
}

export const store = new ConfigStore();
export const getConfig = () => store.config;
export const getActions = () => store.actions;
export const getRules = () => store.rules;
