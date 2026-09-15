import { getRules } from '../core/config.js';

export function classify(text, rules = getRules()) {
  const raw = String(text ?? '');
  for (const rule of rules) {
    for (const pattern of rule.patterns || []) {
      let re;
      try { re = new RegExp(pattern, 'i'); } catch { continue; }
      if (re.test(raw)) {
        return {
          id: rule.id,
          type: rule.type || 'retry',
          cooldownMs: rule.cooldownMs || 0,
          matched: pattern,
        };
      }
    }
  }
  return { id: 'unknown', type: 'retry', cooldownMs: 1500, matched: null };
}

export const TERMINAL_TYPES = new Set(['success', 'done', 'fatal', 'cooldownTime']);

export function isSuccess(v) { return v.type === 'success' || v.type === 'done'; }
export function isFatal(v) { return v.type === 'fatal'; }
export function isUnknown(v) { return v.id === 'unknown'; }
