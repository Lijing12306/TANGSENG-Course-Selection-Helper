import { api, toast, getToken } from './api.js';
import { connectSse } from './sse.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
let latestDraft = null;
let notifyEnabled = false;

// --------------------------------------------------------------------------
// 导航
// --------------------------------------------------------------------------
function switchView(name) {
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  location.hash = name;
  if (name === 'logs') loadLogs();
  if (name === 'courses') loadSelected();
  if (name === 'settings') loadConfig();
  if (name === 'tasks') loadTasks();
}

// --------------------------------------------------------------------------
// 状态
// --------------------------------------------------------------------------
async function refreshStatus() {
  try {
    const s = await api.status();
    const sess = s.session;
    $('#badge-session').className = `badge ${sess.loggedIn ? 'ok' : 'err'}`;
    $('#badge-session').textContent = sess.loggedIn ? `已登录 ${sess.username || ''}` : '未登录';
    $('#badge-engine').className = `badge ${s.engine.running ? 'ok' : ''}`;
    $('#badge-engine').textContent = s.engine.running ? '引擎运行中' : '引擎已停止';
    $('#badge-calib').className = `badge ${s.calibrated ? 'ok' : 'warn'}`;
    $('#badge-calib').textContent = s.calibrated ? '接口已校准' : '接口未校准';

    $('#stat-cookies').textContent = (sess.cookies || []).join(', ') || '(无)';
    $('#stat-jsession').textContent = sess.hasJSession ? '有' : '无';
    $('#stat-route').textContent = sess.hasRoute ? '有' : '无';
    $('#stat-rps').textContent = `${sess.limiter.rps}/s (并发 ${sess.limiter.active})`;
    $('#stat-tasks').textContent = `${s.engine.tasks} 个`;
    $('#stat-counts').textContent = Object.entries(s.engine.counts || {}).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
    $('#stat-uptime').textContent = s.engine.uptime ? `${Math.round(s.engine.uptime / 1000)}s` : '-';
  } catch (err) {
    toast(`状态获取失败: ${err.message}`, 'err');
  }
}

// --------------------------------------------------------------------------
// 任务
// --------------------------------------------------------------------------
function taskRow(t) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${esc(t.name)}<div class="hint">${esc(describeTarget(t))}</div></td>
    <td><span class="tag ${t.state}">${t.state}</span></td>
    <td>${t.stats?.polls || 0}</td>
    <td>${t.stats?.submits || 0}</td>
    <td class="hint">${esc(t.lastMsg || t.lastErr || '')}</td>
    <td></td>`;
  const cell = tr.lastElementChild;
  const mk = (label, fn, cls = 'sm ghost') => {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.onclick = async () => { try { await fn(); await loadTasks(); await refreshStatus(); } catch (e) { toast(e.message, 'err'); } };
    cell.appendChild(b);
  };
  if (t.state === 'running') mk('暂停', () => api.taskAction(t.id, 'pause'));
  else if (t.state !== 'success') mk('开始', () => api.taskAction(t.id, 'start'));
  mk('执行一次', () => api.taskAction(t.id, 'runOnce'));
  mk('重置', () => api.taskAction(t.id, 'reset'));
  mk('删除', async () => { if (confirm(`删除任务「${t.name}」？`)) await api.removeTask(t.id); }, 'sm danger');
  return tr;
}

function describeTarget(t) {
  const g = t.target || {};
  const bits = [];
  if (g.courseName) bits.push(g.courseName);
  if (g.kcmcRegex) bits.push(`/${g.kcmcRegex}/`);
  if (g.teacherRegex) bits.push(`教师/${g.teacherRegex}/`);
  if (g.jxbIds?.length) bits.push(`教学班×${g.jxbIds.length}`);
  return bits.join(' ') || '(未设置目标)';
}

async function loadTasks() {
  try {
    const { tasks } = await api.tasks();
    const tbody = $('#tasks-body');
    tbody.innerHTML = '';
    if (!tasks.length) tbody.innerHTML = '<tr><td colspan="6" class="hint">暂无任务，请在下方新建，或在【课程】页点「加入监控」</td></tr>';
    for (const t of tasks) tbody.appendChild(taskRow(t));
  } catch (err) { toast(err.message, 'err'); }
}

async function createTask() {
  const name = $('#task-name').value.trim();
  const kcmc = $('#task-kcmc').value.trim();
  const teacher = $('#task-teacher').value.trim();
  const jxbIds = $('#task-jxb').value.split(/[\s,]+/).filter(Boolean);
  const mode = $('#task-mode').value;
  const startAt = $('#task-start').value ? new Date($('#task-start').value).toISOString() : null;
  const keyword = $('#task-keyword').value.trim();
  if (!name && !kcmc && !jxbIds.length) return toast('请至少填写任务名或课程名/教学班', 'err');
  try {
    await api.addTask({
      name: name || kcmc || '未命名任务',
      mode,
      startAt,
      target: {
        courseName: kcmc, kcmcRegex: kcmc, teacherRegex: teacher, jxbIds, keyword,
      },
    });
    toast('任务已创建', 'ok');
    $('#task-name').value = ''; $('#task-kcmc').value = ''; $('#task-teacher').value = ''; $('#task-jxb').value = '';
    await loadTasks();
  } catch (err) { toast(err.message, 'err'); }
}

// --------------------------------------------------------------------------
// 课程
// --------------------------------------------------------------------------
async function searchCourses() {
  const kw = $('#course-kw').value.trim();
  $('#courses-body').innerHTML = '<tr><td colspan="7" class="hint">查询中…</td></tr>';
  try {
    const { list } = await api.courses(kw);
    const tbody = $('#courses-body');
    tbody.innerHTML = '';
    if (!list.length) tbody.innerHTML = '<tr><td colspan="7" class="hint">无结果（若接口未校准，请先完成抓包导入）</td></tr>';
    for (const c of list) {
      const tr = document.createElement('tr');
      const sel = Number(c.selected); const cap = Number(c.capacity);
      const avail = Number.isFinite(sel) && Number.isFinite(cap) && cap > 0 ? cap - sel : null;
      tr.innerHTML = `
        <td>${esc(c.courseName || '')}</td>
        <td>${esc(c.teacher || '')}</td>
        <td>${esc(c.time || '')}</td>
        <td>${avail === null ? '-' : `<b style="color:${avail > 0 ? 'var(--ok)' : 'var(--err)'}">${avail}</b>`}</td>
        <td>${esc(String(c.selected ?? ''))}/${esc(String(c.capacity ?? ''))}</td>
        <td class="hint">${esc(String(c.classId || ''))}</td>
        <td></td>`;
      const cell = tr.lastElementChild;
      const b1 = document.createElement('button');
      b1.className = 'btn sm ghost'; b1.textContent = '加入监控';
      b1.onclick = () => {
        $('#task-name').value = c.courseName || '';
        $('#task-kcmc').value = c.courseName || '';
        $('#task-keyword').value = c.courseName || '';
        $('#task-jxb').value = c.classId || '';
        switchView('tasks');
        toast('已填入任务表单，请核对后创建', 'ok');
      };
      const b2 = document.createElement('button');
      b2.className = 'btn sm'; b2.textContent = '立即选课';
      b2.onclick = async () => {
        if (!confirm(`确认提交选课：${c.courseName} / ${c.teacher || ''}？`)) return;
        try {
          const r = await api.select({ kchId: c.courseId, jxbIds: c.classId });
          toast(`HTTP ${r.status} 判定=${r.verdict.id}`, r.verdict.type === 'success' ? 'ok' : 'err');
        } catch (e) { toast(e.message, 'err'); }
      };
      cell.appendChild(b1); cell.appendChild(b2);
      tbody.appendChild(tr);
    }
  } catch (err) {
    $('#courses-body').innerHTML = `<tr><td colspan="7" class="hint">查询失败：${esc(err.message)}</td></tr>`;
  }
}

async function loadSelected() {
  $('#selected-body').innerHTML = '<tr><td colspan="5" class="hint">加载中…</td></tr>';
  try {
    const { list } = await api.selected();
    const tbody = $('#selected-body');
    tbody.innerHTML = '';
    if (!list.length) tbody.innerHTML = '<tr><td colspan="5" class="hint">暂无已选课程</td></tr>';
    for (const c of list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(c.courseName || '')}</td><td>${esc(c.teacher || '')}</td><td>${esc(c.time || '')}</td><td class="hint">${esc(String(c.classId || ''))}</td><td></td>`;
      const b = document.createElement('button');
      b.className = 'btn sm danger'; b.textContent = '退课';
      b.onclick = async () => {
        if (!confirm(`确认退课：${c.courseName}？`)) return;
        try { const r = await api.drop({ kchId: c.courseId, jxbIds: c.classId }); toast(`HTTP ${r.status} ${r.verdict.id}`, 'ok'); await loadSelected(); }
        catch (e) { toast(e.message, 'err'); }
      };
      tr.lastElementChild.appendChild(b);
      tbody.appendChild(tr);
    }
  } catch (err) {
    $('#selected-body').innerHTML = `<tr><td colspan="5" class="hint">加载失败：${esc(err.message)}</td></tr>`;
  }
}

// --------------------------------------------------------------------------
// 抓包导入
// --------------------------------------------------------------------------
async function copySnippet() {
  const text = $('#snippet').textContent;
  try { await navigator.clipboard.writeText(text); toast('抓包脚本已复制，去选课页 F12 控制台粘贴', 'ok'); }
  catch { toast('复制失败，请手动全选复制', 'err'); }
}

async function importCapture() {
  const raw = $('#capture-input').value.trim();
  if (!raw) return toast('请先粘贴抓包 JSON 或 cURL', 'err');
  try {
    const r = await api.importCapture(raw);
    latestDraft = r.draft;
    $('#capture-diff').textContent = r.diff || '(无差异信息)';
    $('#capture-summary').textContent = `解析到 ${r.entries} 条请求，识别到动作：${Object.keys(r.draft).join(', ') || '(无)'}`;
    $('#btn-apply-capture').disabled = !Object.keys(r.draft).length;
    toast('导入成功，请核对差异后点击「应用」', 'ok');
  } catch (err) { toast(`导入失败: ${err.message}`, 'err'); }
}

async function applyCapture() {
  if (!latestDraft) return;
  try {
    const r = await api.applyCapture(latestDraft, true);
    toast(`已应用并标记为已校准（备份：${r.backup}）`, 'ok');
    await refreshStatus();
    await loadActions();
  } catch (err) { toast(err.message, 'err'); }
}

// --------------------------------------------------------------------------
// 设置
// --------------------------------------------------------------------------
async function loadConfig() {
  try {
    const { config, hasStoredPassword } = await api.config();
    $('#cfg-username').value = config.account?.username || '';
    $('#cfg-password').value = hasStoredPassword ? '' : '';
    $('#cfg-password').placeholder = hasStoredPassword ? '已保存（留空则不改）' : '未设置';
    $('#cfg-xnm').value = config.term?.xnm || '';
    $('#cfg-xqm').value = config.term?.xqm || '';
    $('#cfg-rps').value = config.engine?.requestsPerSecond ?? 1;
    $('#cfg-concurrent').value = config.engine?.maxConcurrentRequests ?? 2;
    $('#cfg-interval').value = config.engine?.defaultIntervalMs ?? 3000;
    $('#cfg-dryrun').checked = !!config.engine?.dryRun;
    $('#cfg-manualcookie').value = config.session?.manualCookie || '';
  } catch (err) { toast(err.message, 'err'); }
}

async function saveConfig() {
  const password = $('#cfg-password').value;
  const patch = {
    account: { username: $('#cfg-username').value.trim() },
    term: { xnm: $('#cfg-xnm').value.trim(), xqm: $('#cfg-xqm').value.trim() },
    engine: {
      requestsPerSecond: Number($('#cfg-rps').value) || 1,
      maxConcurrentRequests: Number($('#cfg-concurrent').value) || 2,
      defaultIntervalMs: Number($('#cfg-interval').value) || 3000,
      dryRun: $('#cfg-dryrun').checked,
    },
    session: { manualCookie: $('#cfg-manualcookie').value.trim() },
  };
  if (password) patch.account.password = password;
  try {
    await api.saveConfig(patch);
    toast('设置已保存', 'ok');
    if ($('#cfg-manualcookie').value.trim()) { await api.setCookie($('#cfg-manualcookie').value.trim()); toast('已载入手动 Cookie', 'ok'); }
    await refreshStatus();
  } catch (err) { toast(err.message, 'err'); }
}

async function doLogin(withCaptcha = false) {
  const username = $('#cfg-username')?.value.trim() || undefined;
  const password = $('#cfg-password')?.value || undefined;
  const yzm = withCaptcha ? ($('#cfg-captcha')?.value.trim() || '') : undefined;
  if (withCaptcha && !yzm) return toast('请输入验证码', 'err');
  try {
    const r = await api.login(username, password, yzm);
    if (r.needCaptcha) {
      $('#captcha-box').style.display = 'block';
      if (r.captcha) $('#captcha-img').src = r.captcha;
      $('#captcha-msg').textContent = `${r.message}。图片不显示时请先到【设置】保存账号密码。`;
      toast(r.message, 'err');
      return;
    }
    toast(`登录成功：${r.message}`, 'ok');
    $('#captcha-box').style.display = 'none';
    $('#cfg-captcha').value = '';
    $('#cfg-password').value = '';
    await refreshStatus();
  } catch (err) { toast(`登录失败：${err.message}`, 'err'); }
}

async function refreshCaptcha() {
  try {
    const r = await api.captcha();
    if (r.captcha) $('#captcha-img').src = r.captcha;
    else toast('获取验证码图片失败', 'err');
  } catch (e) { toast(e.message, 'err'); }
}

async function loadActions() {
  try {
    const { actions } = await api.actions();
    $('#actions-editor').value = JSON.stringify(actions, null, 2);
  } catch (err) { toast(err.message, 'err'); }
}

async function saveActions() {
  try {
    const parsed = JSON.parse($('#actions-editor').value);
    await api.saveActions(parsed);
    toast('接口定义已保存并热重载', 'ok');
  } catch (err) { toast(`保存失败：${err.message}`, 'err'); }
}

async function testNotify() {
  try {
    const r = await api.notifyTest();
    toast(`通知测试：${r.results.map((x) => `${x.type}${x.provider ? `/${x.provider}` : ''}=${x.ok ? 'ok' : 'fail'}`).join('  ')}`, 'ok');
  } catch (err) { toast(err.message, 'err'); }
}

// --------------------------------------------------------------------------
// 日志
// --------------------------------------------------------------------------
function appendLog(entry) {
  const boxes = $$('.logbox');
  if (!boxes.length) return;
  const autoscroll = $('#log-autoscroll')?.checked !== false;
  for (const box of boxes) {
    const div = document.createElement('div');
    div.className = `l ${entry.level}`;
    div.textContent = `${(entry.time || '').slice(11, 19)} ${String(entry.level).toUpperCase().padEnd(5)} ${entry.msg}`;
    box.appendChild(div);
    while (box.childElementCount > 800) box.removeChild(box.firstChild);
    if (autoscroll) box.scrollTop = box.scrollHeight;
  }
}

async function loadLogs() {
  try {
    const { logs } = await api.logs(200);
    $$('.logbox').forEach((b) => { b.innerHTML = ''; });
    for (const l of logs) appendLog(l);
  } catch (err) { toast(err.message, 'err'); }
}

// --------------------------------------------------------------------------
// 工具
// --------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function enableBrowserNotify() {
  if (!('Notification' in window)) return toast('浏览器不支持通知', 'err');
  const p = await Notification.requestPermission();
  notifyEnabled = p === 'granted';
  toast(notifyEnabled ? '浏览器通知已开启' : '浏览器通知被拒绝', notifyEnabled ? 'ok' : 'err');
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch { /* ignore */ }
}

// --------------------------------------------------------------------------
// 初始化
// --------------------------------------------------------------------------
function init() {
  getToken();
  $$('nav button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  $('#btn-login').onclick = () => doLogin(false);
  $('#btn-captcha-submit').onclick = () => doLogin(true);
  $('#captcha-img').onclick = refreshCaptcha;
  $('#btn-logout').onclick = async () => { await api.logout(); await refreshStatus(); toast('已清除会话', 'ok'); };
  $('#btn-engine-start').onclick = async () => { await api.engineStart(); await refreshStatus(); await loadTasks(); toast('引擎已启动', 'ok'); };
  $('#btn-engine-stop').onclick = async () => { await api.engineStop(); await refreshStatus(); toast('引擎已停止', 'ok'); };
  $('#btn-refresh').onclick = async () => { await refreshStatus(); await loadTasks(); };
  $('#btn-notify-enable').onclick = enableBrowserNotify;

  $('#btn-task-create').onclick = createTask;
  $('#btn-course-search').onclick = searchCourses;
  $('#btn-selected-refresh').onclick = loadSelected;
  $('#btn-snippet-copy').onclick = copySnippet;
  $('#btn-capture-import').onclick = importCapture;
  $('#btn-apply-capture').onclick = applyCapture;
  $('#btn-config-save').onclick = saveConfig;
  $('#btn-actions-save').onclick = saveActions;
  $('#btn-actions-reload').onclick = loadActions;
  $('#btn-notify-test').onclick = testNotify;

  connectSse({
    onLog: appendLog,
    onTask: () => { loadTasks(); refreshStatus(); },
    onStatus: () => refreshStatus(),
    onNotify: (m) => {
      toast(`${m.title}：${m.body}`, 'ok');
      beep();
      if (notifyEnabled && Notification.permission === 'granted') new Notification(m.title, { body: m.body });
      if (document.hidden) document.title = `(新) ${m.title}`;
    },
    onOpen: () => { $('#badge-sse').className = 'badge ok'; $('#badge-sse').textContent = '实时连接'; },
    onError: () => { $('#badge-sse').className = 'badge err'; $('#badge-sse').textContent = '连接断开'; },
  });

  const initial = (location.hash || '#dashboard').slice(1);
  switchView(['dashboard', 'tasks', 'courses', 'capture', 'settings', 'logs'].includes(initial) ? initial : 'dashboard');
  $('#snippet').textContent = '加载中…';
  api.snippet().then((r) => { $('#snippet').textContent = r.snippet; }).catch(() => { $('#snippet').textContent = '加载失败'; });

  refreshStatus();
  loadTasks();
  setInterval(refreshStatus, 5000);
}

document.addEventListener('DOMContentLoaded', init);
