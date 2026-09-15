#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# ---- 优先使用自带的便携版 Node ----
if [ -x "./node/bin/node" ]; then
  NODE="./node/bin/node"
elif [ -x "./node/node" ]; then
  NODE="./node/node"
elif command -v node >/dev/null 2>&1; then
  NODE="node"
else
  echo "[错误] 未检测到 Node.js，请先安装 Node.js 18 或更高版本： https://nodejs.org/"
  exit 1
fi

echo "正在启动选课助手，启动后会自动打开浏览器；按 Ctrl+C 停止。"
exec "$NODE" src/main.js "$@"
