import { store } from '../src/core/config.js';
import { Session } from '../src/auth/session.js';
import { startServer } from '../src/server/index.js';
import { Engine } from '../src/engine/engine.js';

const t0 = Date.now();
store.load();
store.config.server.openBrowser = false;
store.config.server.port = 8799;
const config = store.config;

const session = new Session(config);
const { server, engine, token } = await startServer(session, config);

const H = { 'X-Local-Token': token };
const base = 'http://127.0.0.1:8799';

async function probe(path, opts = {}) {
  const res = await fetch(base + path, { headers: H, ...opts });
  const text = await res.text();
  return { status: res.status, text };
}

let failed = 0;
function check(name, cond, extra = '') {
  if (!cond) failed += 1;
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${extra ? `  ${extra}` : ''}`);
}

const idx = await probe('/', { headers: {} });
check('GET / 返回页面', idx.status === 200 && idx.text.includes('选课助手'), `status=${idx.status}`);

const noauth = await probe('/api/status', { headers: {} });
check('无令牌访问 /api/status 返回 401', noauth.status === 401, `status=${noauth.status}`);

const st = await probe('/api/status');
check('GET /api/status 200', st.status === 200, `status=${st.status}`);
check('status 含 session/engine', /"session"/.test(st.text) && /"engine"/.test(st.text));

const tasks = await probe('/api/tasks');
check('GET /api/tasks 200', tasks.status === 200, `status=${tasks.status}`);

const created = await probe('/api/tasks', {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '冒烟测试任务', mode: 'watch', target: { kcmcRegex: '测试' } }),
});
check('POST /api/tasks 创建任务', created.status === 200 && created.text.includes('冒烟测试任务'), `status=${created.status}`);

const list = await probe('/api/tasks');
const taskId = JSON.parse(list.text).tasks[0]?.id;
check('任务已持久化到列表', !!taskId, taskId);

const cfg = await probe('/api/config');
const cfgJson = JSON.parse(cfg.text);
const pw = cfgJson.config?.account?.password;
check('GET /api/config 密码已脱敏（空或 ******）', pw === '' || pw === '******', `password=${JSON.stringify(pw)}`);

const actions = await probe('/api/actions');
check('GET /api/actions 200', actions.status === 200 && /queryCourses/.test(actions.text));

const snippet = await probe('/api/capture/snippet');
check('GET /api/capture/snippet 返回脚本', snippet.status === 200 && snippet.text.includes('__capMark'));

const imp = await probe('/api/capture/import', {
  method: 'POST',
  headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    raw: JSON.stringify({
      version: 1,
      entries: [{
        id: 1, method: 'POST', tag: '选课',
        url: 'https://jwxt.zjgsu.edu.cn/jwglxt/xsxk/zzxkyzb_xzYzbKc.html?gnmkdm=N253512&time=1',
        path: '/jwglxt/xsxk/zzxkyzb_xzYzbKc.html',
        query: { gnmkdm: 'N253512', time: '1' },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        bodyForm: { jxb_ids: 'AAA', kch_id: 'BBB', xkxnm: '2026', xkxqm: '3' },
        status: 200, responseSnippet: '{"code":"1","msg":"选课成功"}',
      }],
    }),
  }),
});
check('POST /api/capture/import 解析成功', imp.status === 200 && imp.text.includes('selectCourse'), imp.text.slice(0, 200));

const logs = await probe('/api/logs?limit=10');
check('GET /api/logs 200', logs.status === 200 && /"logs"/.test(logs.text));

if (taskId) {
  const del = await probe(`/api/tasks/${taskId}`, { method: 'DELETE' });
  check('DELETE /api/tasks/:id', del.status === 200);
}

console.log(`\n用时 ${Date.now() - t0}ms  结果：${failed === 0 ? '全部通过 ✅' : `${failed} 项失败 ❌`}`);
server.close();
engine.stop();
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 300);
