import { PlaceholderError } from '../core/errors.js';

const RE_SRC = '\\{\\{?([a-zA-Z0-9_]+)\\}\\}?';
const re = () => new RegExp(RE_SRC, 'g');

export function hasPlaceholder(value) {
  return typeof value === 'string' && re().test(value);
}

export function extractPlaceholders(value) {
  if (typeof value !== 'string') return [];
  const out = [];
  let m;
  const r = re();
  while ((m = r.exec(value))) out.push(m[1]);
  return out;
}

export function fill(value, params, { actionName = '', strict = true } = {}) {
  if (typeof value !== 'string') return value;
  return value.replace(re(), (_full, name) => {
    const present = Object.prototype.hasOwnProperty.call(params, name);
    const v = params[name];
    if (!present || v === undefined || v === null) {
      if (strict) throw new PlaceholderError(name, actionName);
      return '';
    }
    return String(v);
  });
}

export function fillObject(obj, params, opts) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? fill(v, params, opts) : v;
  }
  return out;
}
