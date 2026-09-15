const INPUT_RE = /<input\b[^>]*>/gi;

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

export function extractInputs(html) {
  const out = {};
  const tags = String(html || '').match(INPUT_RE) || [];
  for (const tag of tags) {
    const value = attr(tag, 'value');
    if (value == null) continue;
    const name = attr(tag, 'name');
    const id = attr(tag, 'id');
    if (name) out[name] = value;
    if (id) out[id] = value;
  }
  return out;
}

export function extractCsrfToken(html) {
  const inputs = extractInputs(html);
  if (inputs.csrftoken) return inputs.csrftoken;
  const direct = String(html || '').match(/csrftoken\s*[:=]\s*["']([0-9a-fA-F-]{16,})["']/i);
  if (direct) return direct[1];
  return null;
}

export function extractHiddenConfig(html) {
  const inputs = extractInputs(html);
  const pick = (k) => (inputs[k] !== undefined ? inputs[k] : null);
  return {
    csrftoken: extractCsrfToken(html),
    mmsfjm: pick('mmsfjm'),
    dlsfbxyzm: pick('dlsfbxyzm'),
    mmsrddcshkzfs: pick('mmsrddcshkzfs'),
    dxsyrz: pick('dxsyrz'),
    userPolicyOn: pick('userPolicyOn'),
    xxdm: pick('xxdm'),
    yzcskz: pick('yzcskz'),
    dlsbsdsj: pick('dlsbsdsj'),
    sfxswechatlogin: pick('sfxswechatlogin'),
    authJwglxtLoginURL: pick('authJwglxtLoginURL'),
    sfzywqh: pick('sfzywqh'),
  };
}

export function extractOptions(html, selectName) {
  const re = new RegExp(`<select\\b[^>]*\\b(?:name|id)\\s*=\\s*["']?${selectName}["']?[^>]*>([\\s\\S]*?)</select>`, 'i');
  const m = String(html || '').match(re);
  if (!m) return [];
  const options = [];
  const optRe = /<option\b[^>]*value\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/option>/gi;
  let o;
  while ((o = optRe.exec(m[1]))) {
    options.push({ value: (o[1] ?? o[2] ?? o[3] ?? '').trim(), label: (o[4] || '').trim() });
  }
  return options;
}

export function hasLoginForm(html) {
  return /<input\b[^>]*\bname\s*=\s*["']?yhm["']?/i.test(String(html || ''));
}

export function detectCaptcha(html) {
  return /<input\b[^>]*\b(?:name|id)\s*=\s*["']?yzm["']?/i.test(String(html || ''));
}
