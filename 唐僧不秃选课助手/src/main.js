import { store } from './core/config.js';
import { logger } from './core/logger.js';
import { Session } from './auth/session.js';
import { runCli } from './cli.js';

async function main() {
  const argv = process.argv.slice(2);
  const created = store.load();
  store.watch();

  if (created.length) {
    logger.info(`已生成默认配置文件: ${created.join(', ')}（请在 config/config.json 中填写账号）`);
  }

  if (argv.length > 0) {
    const code = await runCli(argv);
    process.exit(code);
  }

  const config = store.config;
  const session = new Session(config);
  const { startServer } = await import('./server/index.js');
  await startServer(session, config);
}

main().catch((err) => {
  if (err && err.friendly) {
    process.stderr.write(`\n[启动失败] ${err.message}\n`);
    process.exit(1);
    return;
  }
  logger.error('启动失败', err);
  process.stderr.write(`\n[致命错误] ${err.message}\n${err.stack || ''}\n`);
  process.exit(1);
});
