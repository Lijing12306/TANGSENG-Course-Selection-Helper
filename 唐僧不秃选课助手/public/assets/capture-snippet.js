/* ============================================================================
 * 正方教务系统「选课接口抓包」控制台脚本  (uni-agent 生成)
 * ----------------------------------------------------------------------------
 * 用法：
 *   1. 浏览器登录选课页（地址含 zzxkyzb_cxZzxkYzbIndex.html）
 *   2. F12 → Console，粘贴本文件全部内容 → 回车
 *   3. 执行 __capMark("选课") 后，手动点一次「选课」按钮
 *   4. 执行 __capTable() 确认抓到了 zzxkyzb 的 POST
 *   5. 执行 __capCopy() 复制 JSON，或 __capDownload() 下载文件
 * 仅记录本次手动操作，不会自动重放或自动提交。
 * ==========================================================================*/
(function () {
  if (window.__CAP__) { console.warn('[capture] 脚本已安装，忽略重复注入'); return; }
  var MAX = 80, MAXR = 4000, MAXB = 20000;
  var st = { id: 0, on: true, mark: 'start', entries: [] };
  window.__CAP__ = st;

  function now() { return Date.now(); }
  function cut(s, n) {
    if (typeof s !== 'string') return s;
    return s.length > n ? s.slice(0, n) + '...[+' + (s.length - n) + ']' : s;
  }
  function norm(b) {
    try {
      if (b == null) return null;
      if (typeof b === 'string') return b;
      if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return b.toString();
      if (typeof FormData !== 'undefined' && b instanceof FormData) {
        var o = {};
        b.forEach(function (v, k) { o[k] = o[k] === undefined ? v : [].concat(o[k], v); });
        return JSON.stringify(o);
      }
      if (typeof Blob !== 'undefined' && b instanceof Blob) return '[Blob ' + b.size + ']';
      if (b instanceof ArrayBuffer) return '[Binary ' + b.byteLength + ']';
      return JSON.stringify(b);
    } catch (e) { return '[? ' + e.message + ']'; }
  }
  function formObj(s) {
    try {
      var o = {};
      var p = new URLSearchParams(s);
      p.forEach(function (v, k) { o[k] = o[k] === undefined ? v : [].concat(o[k], v); });
      return o;
    } catch (e) { return null; }
  }
  function meta(url) {
    try {
      var u = new URL(url, location.href);
      var q = {};
      u.searchParams.forEach(function (v, k) { q[k] = v; });
      return { origin: u.origin, path: u.pathname, query: q, host: u.host };
    } catch (x) { return { origin: '', path: '', query: {}, host: '' }; }
  }
  function interesting(url) { return /jwglxt|xsxk|zzxkyzb|jwxt/i.test(String(url)); }
  function push(e) { st.entries.push(e); if (st.entries.length > MAX) st.entries.shift(); }

  /* ---- XHR ---- */
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  var _sh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) {
    this.__c = { kind: 'xhr', method: String(m || 'GET').toUpperCase(), url: String(u), headers: {}, t0: now() };
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__c) this.__c.headers[k] = v; } catch (e) {}
    return _sh.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var r = this.__c, self = this;
    if (r && st.on && interesting(r.url)) {
      r.id = ++st.id; r.ts = now(); r.tag = st.mark;
      r.bodyRaw = cut(norm(body), MAXB);
      r.bodyForm = formObj(r.bodyRaw);
      var mm = meta(r.url);
      r.origin = mm.origin; r.path = mm.path; r.query = mm.query;
      push(r);
      this.addEventListener('loadend', function () {
        try {
          r.status = self.status;
          r.durationMs = now() - r.t0;
          r.responseSnippet = cut(
            (self.responseType === '' || self.responseType === 'text') ? self.responseText : '[' + self.responseType + ']',
            MAXR
          );
        } catch (e) { r.status = -1; }
      });
    }
    return _send.apply(this, arguments);
  };

  /* ---- fetch ---- */
  var _f = window.fetch;
  if (_f) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var r = {
        kind: 'fetch', id: ++st.id, ts: now(), tag: st.mark, t0: now(),
        method: String((init && init.method) || (input && input.method) || 'GET').toUpperCase(),
        url: url, headers: {}, bodyRaw: cut(norm(init && init.body), MAXB)
      };
      r.bodyForm = formObj(r.bodyRaw);
      var mm = meta(url);
      r.origin = mm.origin; r.path = mm.path; r.query = mm.query;
      try {
        new Headers((init && init.headers) || (input && input.headers) || {}).forEach(function (v, k) { r.headers[k] = v; });
      } catch (e) {}
      if (st.on && interesting(url)) push(r);
      return _f.apply(this, arguments).then(function (res) {
        try {
          var c = res.clone();
          c.text().then(function (t) { r.status = c.status; r.responseSnippet = cut(t, MAXR); });
        } catch (e) {}
        return res;
      });
    };
  }

  /* ---- 原生 form.submit ---- */
  var _sub = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () {
    try {
      var fd = {}, form = this;
      new FormData(form).forEach(function (v, k) { fd[k] = v; });
      var p = new URLSearchParams();
      for (var k in fd) p.append(k, fd[k]);
      var mm = meta(form.action || location.href);
      push({
        kind: 'form', id: ++st.id, ts: now(), tag: st.mark,
        method: String(form.method || 'POST').toUpperCase(), url: form.action || location.href,
        origin: mm.origin, path: mm.path, query: mm.query,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        bodyForm: fd, bodyRaw: p.toString()
      });
    } catch (e) {}
    return _sub.apply(this, arguments);
  };

  /* ---- 导出 API ---- */
  window.__capExport = function () {
    var gnmkdm = null;
    try { gnmkdm = new URLSearchParams(location.search).get('gnmkdm'); } catch (e) {}
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      page: { url: location.href, title: document.title, ua: navigator.userAgent, gnmkdm: gnmkdm },
      entries: st.entries.map(function (e) {
        var o = {};
        for (var k in e) o[k] = e[k];
        return o;
      })
    };
  };
  window.__capDump = function () { return JSON.stringify(window.__capExport(), null, 2); };
  window.__capTable = function () {
    console.table(st.entries.map(function (e) {
      return { id: e.id, mark: e.tag, method: e.method, path: e.path, status: e.status, body: e.bodyRaw ? e.bodyRaw.slice(0, 60) : '' };
    }));
  };
  window.__capMark = function (m) { st.mark = m || ('m' + st.entries.length); console.log('[capture] 标记 =', st.mark); };
  window.__capPause = function (v) { st.on = v === undefined ? !st.on : !!v; console.log('[capture] 记录中 =', st.on); };
  window.__capCopy = function () {
    var t = window.__capDump();
    try { copy(t); console.log('[capture] ✅ JSON 已复制到剪贴板'); } catch (e) { console.log(t); }
    return t;
  };
  window.__capDownload = function () {
    var b = new Blob([window.__capDump()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'capture-' + Date.now() + '.json';
    a.click();
  };
  window.__capFilter = function (kw) {
    console.table(st.entries.filter(function (e) { return (e.path + e.url).indexOf(kw) >= 0; })
      .map(function (e) { return { id: e.id, method: e.method, path: e.path, form: e.bodyForm }; }));
  };

  console.log('%c[capture] 已安装 ✅  操作页面 → __capTable() 概览 → __capMark("选课") 打点 → __capCopy()/__capDownload() 导出',
    'color:#0a0;font-weight:bold');
})();
