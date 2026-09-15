import readline from 'node:readline/promises';
import { store } from './core/config.js';
import { logger } from './core/logger.js';
import { Session } from './auth/session.js';
import { runDoctor } from '../tools/doctor.js';
import { saveAccount } from './core/secrets.js';
import { queryCourses, getSelected, resolveTerm, selectCourse, dropCourse, filterCourses } from './zf/course.js';

const HELP = `
用法: node src/main.js <命令> [参数]

命令:
  serve                 启动本地 Web 控制台（默认）
  doctor                全链路自检（登录页 / RSA 公钥 / 加密 / Cookie）
  login                 验证账号密码登录
  selftest              RSA 加密自测（不联网）
  query [关键词]        查询可选课程
  selected              查看已选课程
  select <kchId> <jxbId> 手动选课一次（需已校准接口）
  drop   <kchId> <jxbId> 手动退课（需已校准接口）
  term                  从选课首页解析学年学期

账号设置:
  set-account <学号> <密码>   加密保存账号密码到 data/secrets.json

示例:
  node src/main.js doctor
  node src/main.js set-account 20230001 mypassword
  node src/main.js login
  node src/main.js query 数据结构
`;

async function ensureSession() {
  const config = store.load();
  const session = new Session(config);
  return { config, session };
}

function printTable(rows, cols) {
  if (!rows.length) {
    process.stdout.write('(无数据)\n');
    return;
  }
  const widths = cols.map((c) => Math.max(c.title.length, ...rows.map((r) => String(r[c.key] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  process.stdout.write(`${line(cols.map((c) => c.title))}\n`);
  process.stdout.write(`${widths.map((w) => '-'.repeat(w)).join('  ')}\n`);
  for (const r of rows) process.stdout.write(`${line(cols.map((c) => r[c.key] ?? ''))}\n`);
}

export async function runCli(argv) {
  const [cmd, ...args] = argv;

  if (cmd === 'selftest') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['tools/rsa-selftest.js'], { stdio: 'inherit', cwd: process.cwd() });
    return r.status ?? 1;
  }

  if (cmd === 'doctor') return runDoctor();

  if (cmd === 'serve') {
    const { startServer } = await import('./server/index.js');
    const { session } = await ensureSession();
    await startServer(session);
    return 0;
  }

  if (cmd === 'set-account') {
    const [username, password] = args;
    if (!username || !password) {
      process.stderr.write('用法: set-account <学号> <密码>\n');
      return 1;
    }
    saveAccount(username, password);
    store.saveConfig({ account: { username, password: '' } });
    process.stdout.write(`已加密保存账号 ${username} 到 data/secrets.json\n`);
    return 0;
  }

  if (cmd === 'login') {
    const { session } = await ensureSession();
    const { DATA_DIR } = await import('./core/storage.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { spawn } = await import('node:child_process');
    const [u, p] = args;
    let yzm;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const r = await session.login({ force: true, username: u || undefined, password: p || undefined, yzm });
        process.stdout.write(`✅ 登录成功: ${r.message}\n`);
        const st = session.status();
        process.stdout.write(`   cookies: ${st.cookies.join(', ')}\n`);
        process.stdout.write(`   JSESSIONID: ${st.hasJSession ? '有' : '无'}, route: ${st.hasRoute ? '有' : '无'}\n`);
        return 0;
      } catch (err) {
        if (err.code === 'CAPTCHA_REQUIRED') {
          process.stdout.write(`${err.message}\n`);
          if (err.captchaDataUrl) {
            const file = path.join(DATA_DIR, 'captcha.png');
            fs.writeFileSync(file, Buffer.from(err.captchaDataUrl.split(',')[1], 'base64'));
            process.stdout.write(`验证码图片已保存到 ${file}，正在打开…\n`);
            try { spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref(); } catch { /* ignore */ }
          }
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          yzm = (await rl.question('请输入图中的验证码: ')).trim();
          rl.close();
          continue;
        }
        process.stderr.write(`❌ 登录失败: ${err.message}\n`);
        if (err.detail) process.stderr.write(`   服务器返回片段: ${String(err.detail).slice(0, 300)}\n`);
        return 1;
      }
    }
    process.stderr.write('❌ 验证码重试次数过多，已放弃\n');
    return 1;
  }

  if (cmd === 'term') {
    const { session } = await ensureSession();
    await session.login();
    const t = await resolveTerm(session, { force: true });
    process.stdout.write(`学年学期: xnm=${t.xnm}  xqm=${t.xqm}\n`);
    return 0;
  }

  if (cmd === 'query') {
    const { session } = await ensureSession();
    await session.login();
    await resolveTerm(session);
    const kw = args.join(' ');
    const { list, total } = await queryCourses(session, { keyword: kw });
    process.stdout.write(`共 ${total} 条\n`);
    printTable(list, [
      { key: 'courseName', title: '课程名' },
      { key: 'teacher', title: '教师' },
      { key: 'time', title: '时间' },
      { key: 'selected', title: '已选' },
      { key: 'capacity', title: '容量' },
      { key: 'classId', title: '教学班' },
      { key: 'courseId', title: '课程号' },
    ]);
    return 0;
  }

  if (cmd === 'selected') {
    const { session } = await ensureSession();
    await session.login();
    await resolveTerm(session);
    const res = await getSelected(session);
    process.stdout.write(`已选 ${res.list.length} 门\n`);
    printTable(res.list, [
      { key: 'courseName', title: '课程名' },
      { key: 'teacher', title: '教师' },
      { key: 'time', title: '时间' },
      { key: 'classId', title: '教学班' },
    ]);
    return 0;
  }

  if (cmd === 'select' || cmd === 'drop') {
    const [kchId, jxbId] = args;
    if (!kchId || !jxbId) {
      process.stderr.write(`用法: ${cmd} <kchId> <jxbId>\n`);
      return 1;
    }
    const { session } = await ensureSession();
    await session.login();
    const fn = cmd === 'select' ? selectCourse : dropCourse;
    const res = await fn(session, { kchId, jxbIds: jxbId });
    process.stdout.write(`HTTP ${res.status}  判定=${res.verdict.id} (${res.verdict.type})\n`);
    process.stdout.write(`原始响应: ${String(res.raw).slice(0, 500)}\n`);
    return 0;
  }

  process.stdout.write(HELP);
  return cmd ? 1 : 0;
}
